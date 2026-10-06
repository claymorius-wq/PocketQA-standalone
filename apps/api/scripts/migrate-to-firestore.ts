// One-way migration of a SQLite SNAPSHOT into Firestore (docs/plans/firebase-vercel-refactor.md
// §8, r2 §R4, R9).
//
// DRY RUN (emulator only, no object storage):
//   firebase emulators:exec ... 'tsx scripts/migrate-to-firestore.ts --snapshot <copy.sqlite>
//     --expect-sha256 <hex> --media-dir <copy/media> [--receipt <seeker-receipt.json>]
//     --out <manifest.json outside the repo>'
//
// REAL RUN (plan §8.3–8.5; run by the lead with authorised credentials from the environment):
//   tsx scripts/migrate-to-firestore.ts --real --approved-manifest <sha256> [--project <id>]
//     --snapshot <copy.sqlite> --expect-sha256 <hex> --media-dir <copy/media> [--receipt <json>]
//     --out <post-run manifest.json outside the repo>
//   env: FIREBASE_SERVICE_ACCOUNT_JSON, POCKETQA_R2_ACCOUNT_ID, POCKETQA_R2_BUCKET,
//        POCKETQA_R2_ACCESS_KEY_ID, POCKETQA_R2_SECRET_ACCESS_KEY (names only; never printed)
//
// The Seeker receipt defaults to ~/.local/share/pocketqa/migration/seeker-receipt.json (0600);
// nothing under .preview is ever read.
//
// Safety rules (each enforced below, not just documented):
//  - The snapshot is a COPY. Its sha256 is checked before it is opened, it is opened with
//    SQLite `immutable=1` + read-only (no -wal/-shm, never written), and re-hashed afterwards.
//  - Dry run: writes only to the emulator (FIRESTORE_EMULATOR_HOST, loopback, `demo-` project,
//    enforced by openFirestore) and makes no object-storage calls.
//  - Real run refuses before any write unless: the snapshot is THE approved snapshot (sha below,
//    for the real project), the manifest computed in memory hashes to `--approved-manifest`, the
//    target holds no user the plan doesn't migrate, and no planned document exists with
//    different content (identical content = an idempotent rerun). The real project is
//    pocketqa-optijara; `--project demo-…` exists only so tests can run it on the emulator.
//  - Objects first, documents after: each evidence object is uploaded (upload-copy) or
//    server-side copied from the Seeker archive (server-copy), verified by HEAD size and a full
//    GET sha256 equal to the expected one, and only then registered in storageObjects. A failed
//    verify stops the run with that object unregistered. The object helper has NO delete, never
//    writes outside evidence/{id}, and only ever reads the archive key as a copy source.
//  - Migrated non-admin users carry `migrated_link: 'verified_email'`: the first sign-in with a
//    verified password or Google email equal to the stored one may claim the account (plan §7(a)).
//    Admins never do: they are linked by the audited admin-link script (§7(b)).
//  - Deterministic doc ids and contents (no server timestamps, no random ids), written with
//    `set`, so a rerun rewrites identical documents and yields an identical manifest.
//  - Output is counts only; the manifest files hold ids, keys and hashes, never user content.
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Readable } from 'node:stream';
import { openFirestore } from '../src/firestore/admin';

export const TOOL_VERSION = 'migrate-to-firestore/1';
/** The QA-approved snapshot (plan §8.1, R1); the real project accepts no other. */
export const REAL_SNAPSHOT_SHA256 = '3501bc9e96436b10b58ba843509ff670dff08354ca61bfdf698429fbede610e3';
export const REAL_PROJECT = 'pocketqa-optijara';
const BATCH = 400;
const FAUCET = 'system:test-faucet';
export const DEFAULT_RECEIPT = join(homedir(), '.local', 'share', 'pocketqa', 'migration', 'seeker-receipt.json');

type Row = Record<string, string | number | null>;
type Data = Record<string, unknown>;
export type DocWrite = { path: string; data: Data };
/**
 * How an evidence object reaches its target key at real-run time (nothing is copied in the dry run):
 *  - 'upload-copy': the local media file (`sourceKey`, relative to the media dir) is uploaded;
 *  - 'server-copy': an R2 CopyObject from the archived `sourceKey`. Then verify by size plus a
 *    full-GET sha256 equal to `expectedSha256`, register `targetKey` in storageObjects, and point the
 *    evidence doc at it. The archived original stays unregistered and untouched.
 */
export type EvidencePlan = {
  evidenceId: string;
  participationId: string;
  action: 'upload-copy' | 'server-copy';
  sourceKey: string;
  targetKey: string;
  bytes: number;
  expectedSha256: string;
};
export type SeekerReceipt = { evidenceId: string; key: string; sha256: string; bytes: number; bucket?: string };
export type Plan = {
  writes: DocWrite[];
  sourceCounts: Record<string, number>;
  skipped: Record<string, { rows: number; reason: string }>;
  evidence: EvidencePlan[];
  passwordHashesDropped: number;
  migratedLinkUsers: number;
  adminsExcluded: number;
  sourceLedger: Record<string, number>;
};

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const ts = (v: unknown) => Timestamp.fromMillis(typeof v === 'number' ? v : Date.parse(String(v)));

/**
 * Every source table and how it is handled. A table not listed, or a 'must-be-empty' table that
 * has rows, stops the migration: nothing is silently left behind.
 */
const TABLES: Record<string, 'mapped' | { skip: string } | 'must-be-empty'> = {
  users: 'mapped',
  identities: 'mapped',
  studies: 'mapped',
  tasks: 'mapped',
  participations: 'mapped',
  task_notes: 'mapped',
  findings: 'mapped',
  disputes: 'mapped',
  ledger: 'mapped',
  evidence: 'mapped',
  audit: 'mapped',
  wallet_links: 'mapped',
  storage_objects: { skip: 'local media keys; the registry is rebuilt from the evidence target keys (storageObjects)' },
  sessions: { skip: 'transient: hosted auth is Firebase ID tokens (plan §2.1)' },
  playback_tokens: { skip: 'transient: hosted playback is a presigned GET (plan §2.1)' },
  wallet_nonces: { skip: 'transient: single-use link nonces' },
  wallet_login_challenges: { skip: 'transient: single-use login challenges' },
  schema_migrations: { skip: 'SQLite schema bookkeeping (Firestore has no migrations, plan §3 T12)' },
  // Escrow, reputation and upload pipelines: no rows in today's snapshot. Mapping them needs the
  // owners' shapes (pqa-be3, pqa-be2); until then a non-empty table stops the run.
  upload_intents: 'must-be-empty',
  storage_deletions: 'must-be-empty',
  study_escrows: 'must-be-empty',
  escrow_fundings: 'must-be-empty',
  escrow_ledger: 'must-be-empty',
  settlements: 'must-be-empty',
  sim_chain_transfers: 'must-be-empty',
  squads_attempts: 'must-be-empty',
  devnet_transfers: 'must-be-empty',
  points_events: 'must-be-empty',
  points_flags: 'must-be-empty',
  fraud_findings: 'must-be-empty',
  leaderboard_profiles: 'must-be-empty',
};

/** Opens a snapshot copy immutable and read-only, after checking its sha256. */
export function openSnapshot(file: string, expectSha256: string): DatabaseSync {
  const got = sha(readFileSync(file));
  if (got !== expectSha256) throw new Error(`snapshot sha256 mismatch (expected ${expectSha256.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
  return new DatabaseSync(`${pathToFileURL(resolve(file)).href}?immutable=1`, { readOnly: true });
}

/** The documents the repositories would hold for this snapshot (their own shapes and guard docs). */
export function planMigration(db: DatabaseSync, opts: { mediaSha256: (sourceKey: string) => string | null; seeker: SeekerReceipt | null }): Plan {
  const all = (sql: string) => db.prepare(sql).all() as Row[];
  const tables = all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).map((r) => String(r.name));
  const sourceCounts: Record<string, number> = {};
  const skipped: Plan['skipped'] = {};
  for (const t of tables) {
    const n = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as Row).n);
    sourceCounts[t] = n;
    const how = TABLES[t];
    if (how === undefined) throw new Error(`no migration rule for table ${t}`);
    if (how === 'must-be-empty' && n > 0) throw new Error(`table ${t} has ${n} rows but no Firestore mapping yet (coordinate with its owner)`);
    if (typeof how === 'object') skipped[t] = { rows: n, reason: how.skip };
  }

  const writes: DocWrite[] = [];
  const put = (path: string, data: Data) => writes.push({ path, data });

  // ── core (users, identities, audit): repo/core/firestore.ts ─────────────────────────────
  const users = all('SELECT * FROM users ORDER BY id');
  let passwordHashesDropped = 0;
  for (const u of users) {
    // Local password hashes are never migrated to the cloud (plan §7).
    if (u.password_hash !== null) passwordHashesDropped += 1;
    // Plan §7(a): claimable once by a verified sign-in with this exact email (field cleared then).
    // Never for admins (§7(b): audited admin-link script only).
    put(`users/${u.id}`, u.role === 'admin' ? { ...u, password_hash: null } : { ...u, password_hash: null, migrated_link: 'verified_email' });
    // UNIQUE(users.email): exact email, as the core repo keys it (deleted users hold a placeholder).
    put(`userEmails/${sha(String(u.email))}`, { userId: u.id, createdAt: ts(u.created_at) });
  }
  for (const i of all('SELECT * FROM identities ORDER BY provider, subject')) {
    put(`identities/${i.provider}:${i.subject}`, { ...i });
    put(`userProviders/${i.user_id}:${i.provider}`, { uid: i.subject, createdAt: ts(i.created_at) });
  }
  for (const a of all('SELECT * FROM audit ORDER BY created_at, rowid')) put(`audit/${a.id}`, { ...a, writtenAt: ts(a.created_at) });

  // ── studies domain: repo/studies/firestore.ts ──────────────────────────────────────────
  const parts = all('SELECT * FROM participations ORDER BY id');
  const joins = new Map<string, number>();
  for (const p of parts) joins.set(String(p.study_id), (joins.get(String(p.study_id)) ?? 0) + 1);
  for (const s of all('SELECT * FROM studies ORDER BY id')) put(`studies/${s.id}`, { ...s, join_seq: joins.get(String(s.id)) ?? 0 });
  for (const t of all('SELECT * FROM tasks ORDER BY study_id, ord')) put(`studies/${t.study_id}/tasks/${t.id}`, { id: t.id, study_id: t.study_id, ord: t.ord, instruction: t.instruction, success_criteria: t.success_criteria });
  for (const p of parts) {
    put(`participations/${p.id}`, { ...p });
    put(`participationPairs/${p.study_id}_${p.tester_id}`, { participation_id: p.id, createdAt: ts(p.consented_at) });
  }
  for (const n of all('SELECT * FROM task_notes ORDER BY participation_id, task_id')) put(`participations/${n.participation_id}/notes/${n.task_id}`, { task_id: n.task_id, note: n.note });
  for (const f of all('SELECT * FROM findings ORDER BY id')) put(`findings/${f.id}`, { ...f });
  for (const d of all('SELECT d.*, p.study_id AS study_id FROM disputes d JOIN participations p ON p.id = d.participation_id ORDER BY d.id')) {
    put(`disputes/${d.id}`, { ...d });
    put(`disputeByParticipation/${d.participation_id}`, { dispute_id: d.id, createdAt: ts(d.created_at) });
  }
  // Ledger: legacy ids kept; `seq` per account in SQLite insertion order (its rowid tie-break).
  const accounts = new Map<string, { account: string; balance: number; by_kind: Record<string, number>; seq: number }>();
  const sourceLedger: Record<string, number> = {};
  for (const e of all('SELECT * FROM ledger ORDER BY rowid')) {
    const account = String(e.account);
    sourceLedger[account] = (sourceLedger[account] ?? 0) + Number(e.amount);
    let seq = 0;
    if (account !== FAUCET) {
      const a = accounts.get(account) ?? { account, balance: 0, by_kind: {}, seq: 0 };
      a.balance += Number(e.amount);
      a.by_kind[String(e.kind)] = (a.by_kind[String(e.kind)] ?? 0) + Number(e.amount);
      a.seq += 1;
      seq = a.seq;
      accounts.set(account, a);
    }
    put(`ledger/${e.id}`, { id: e.id, tx_id: e.tx_id, account, amount: e.amount, kind: e.kind, study_id: e.study_id, participation_id: e.participation_id, created_at: e.created_at, seq });
    // ledger_one_reward (partial): reward kinds with amount > 0 only.
    if ((e.kind === 'reward_credit' || e.kind === 'dispute_credit') && Number(e.amount) > 0) {
      put(`ledgerRewards/${e.participation_id}:${e.kind}`, { participation_id: e.participation_id, kind: e.kind, tx_id: e.tx_id, createdAt: ts(e.created_at) });
    }
  }
  for (const a of [...accounts.values()].sort((x, y) => x.account.localeCompare(y.account))) put(`accounts/${a.account}`, { ...a });

  // ── evidence domain: repo/evidence/firestore.ts (objects planned, never uploaded here) ─────
  const evidence: EvidencePlan[] = [];
  const usage = new Map<string, { evidence_count: number; evidence_bytes: number; open: Record<string, never> }>();
  for (const e of all('SELECT * FROM evidence ORDER BY id')) {
    const local = opts.mediaSha256(String(e.storage_key));
    if (!local) throw new Error(`evidence ${e.id}: no local media for its storage key`);
    const isSeeker = opts.seeker?.evidenceId === e.id;
    if (isSeeker && (opts.seeker!.sha256 !== local || opts.seeker!.bytes !== Number(e.size_bytes))) {
      throw new Error(`evidence ${e.id}: the archive receipt does not match the local media (sha256 or size)`);
    }
    // Every object lands at the app key evidence/{id} (handlers/evidence.ts finalKey). The Seeker
    // recording gets there by a server-side copy of its archive (r2 §R4: the archive is outside
    // the deletable prefix and is never registered).
    const targetKey = `evidence/${e.id}`;
    evidence.push({
      evidenceId: String(e.id),
      participationId: String(e.participation_id),
      action: isSeeker ? 'server-copy' : 'upload-copy',
      sourceKey: isSeeker ? opts.seeker!.key : String(e.storage_key),
      targetKey,
      bytes: Number(e.size_bytes),
      expectedSha256: local,
    });
    put(`evidence/${e.id}`, { ...e, storage_key: targetKey });
    put(`evidenceSegments/${e.participation_id}:${sha(String(e.client_segment_id))}`, { evidence_id: e.id });
    const u = usage.get(String(e.participation_id)) ?? { evidence_count: 0, evidence_bytes: 0, open: {} };
    u.evidence_count += 1;
    u.evidence_bytes += Number(e.size_bytes);
    usage.set(String(e.participation_id), u);
    put(`storageObjects/${sha(targetKey)}`, { object_key: targetKey, created_at: Date.parse(String(e.created_at)) });
  }
  if (opts.seeker && !evidence.some((e) => e.evidenceId === opts.seeker!.evidenceId)) throw new Error('the Seeker evidence is not in this snapshot');
  for (const [pid, u] of [...usage].sort(([a], [b]) => a.localeCompare(b))) put(`evidenceUsage/${pid}`, u);

  // ── escrow domain (wallet links): repo/escrow/firestore.ts ──────────────────────────────
  for (const w of all('SELECT * FROM wallet_links ORDER BY user_id')) {
    put(`walletLinks/${w.user_id}`, { ...w });
    put(`walletAddresses/${w.address}`, { user_id: w.user_id });
  }

  const paths = new Set<string>();
  for (const w of writes) {
    if (paths.has(w.path)) throw new Error(`two source rows map to one document (${w.path.split('/')[0]}): a uniqueness rule is violated in the source`);
    paths.add(w.path);
  }
  return { writes, sourceCounts, skipped, evidence, passwordHashesDropped, migratedLinkUsers: users.filter((u) => u.role !== 'admin').length, adminsExcluded: users.filter((u) => u.role === 'admin').length, sourceLedger };
}

/** Writes the plan with `set` (deterministic contents), so a rerun is a no-op in effect. */
export async function applyPlan(fs: Firestore, plan: Plan): Promise<void> {
  for (let i = 0; i < plan.writes.length; i += BATCH) {
    const b = fs.batch();
    for (const w of plan.writes.slice(i, i + BATCH)) b.set(fs.doc(w.path), w.data);
    await b.commit();
  }
}

/** Canonical JSON (sorted keys; Timestamps as millis), so checksums don't depend on key order. */
function canonical(v: unknown): string {
  if (v instanceof Timestamp) return JSON.stringify({ $ts: v.toMillis() });
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Data)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const groupOf = (path: string) => {
  const segs = path.split('/');
  return segs.length > 2 ? `${segs[0]}/*/${segs[2]}` : segs[0]!;
};

export type Manifest = {
  tool: string;
  snapshotSha256: string;
  source: { tables: Record<string, number>; skipped: Plan['skipped']; passwordHashesDropped: number };
  users: { migratedLinkPlanned: number; migratedLinkFound: number; adminsExcluded: number };
  target: { collections: Record<string, { planned: number; found: number; checksum: string; matchesPlan: boolean }> };
  relations: { check: string; total: number; unresolved: number }[];
  ledger: { accounts: number; mismatches: number; totalSum: number; faucet: number; matchesSource: boolean };
  evidence: { objects: EvidencePlan[]; uploads: number; serverCopies: number; totalBytes: number };
  seeker: {
    evidenceId: string;
    action: EvidencePlan['action'];
    sourceKey: string;
    targetKey: string;
    expectedSha256: string;
    participationFound: boolean;
    testerFound: boolean;
    evidenceDocPointsAtTarget: boolean;
    targetRegistered: boolean;
    archiveRegistered: boolean;
    playbackPrefixAllowed: boolean;
  } | null;
  ok: boolean;
  manifestSha256?: string;
};

/** Documents by collection group, then path. */
type Docs = Map<string, Map<string, Data>>;
const groupsOf = (plan: Plan) => [...new Set(plan.writes.map((w) => groupOf(w.path)))].sort();

/** What the target holds in the plan's collections (read back). */
async function readTarget(fs: Firestore, plan: Plan): Promise<Docs> {
  const docs: Docs = new Map();
  for (const g of groupsOf(plan)) {
    const parts = g.split('/');
    const snap = parts.length > 1 ? await fs.collectionGroup(parts[2]!).get() : await fs.collection(g).get();
    docs.set(g, new Map(snap.docs.filter((d) => groupOf(d.ref.path) === g).map((d) => [d.ref.path, d.data()])));
  }
  return docs;
}

/** The documents a complete migration of this plan leaves in an otherwise empty target. */
function plannedDocs(plan: Plan): Docs {
  const docs: Docs = new Map(groupsOf(plan).map((g) => [g, new Map()]));
  for (const w of plan.writes) docs.get(groupOf(w.path))!.set(w.path, w.data);
  return docs;
}

/** The manifest, from what is READ BACK from Firestore (not from the plan alone). */
export async function buildManifest(fs: Firestore, plan: Plan, snapshotSha256: string, seeker: SeekerReceipt | null): Promise<Manifest> {
  return manifestOf(await readTarget(fs, plan), plan, snapshotSha256, seeker);
}

/**
 * The manifest a successful run produces, computed in memory from the snapshot alone (no target
 * read). The real run refuses to write unless its hash equals the QA-approved dry-run manifest.
 */
export function plannedManifest(plan: Plan, snapshotSha256: string, seeker: SeekerReceipt | null): Manifest {
  return manifestOf(plannedDocs(plan), plan, snapshotSha256, seeker);
}

function manifestOf(docs: Docs, plan: Plan, snapshotSha256: string, seeker: SeekerReceipt | null): Manifest {
  const groups = groupsOf(plan);
  const collections: Manifest['target']['collections'] = {};
  for (const g of groups) {
    const planned = plan.writes.filter((w) => groupOf(w.path) === g).sort((a, b) => a.path.localeCompare(b.path));
    const found = [...docs.get(g)!].sort(([a], [b]) => a.localeCompare(b));
    const sumOf = (xs: [string, unknown][]) => sha(xs.map(([p, d]) => `${p}\t${canonical(d)}`).join('\n'));
    const checksum = sumOf(found);
    collections[g] = { planned: planned.length, found: found.length, checksum, matchesPlan: checksum === sumOf(planned.map((w) => [w.path, w.data])) };
  }

  const ids = (g: string) => new Set([...(docs.get(g)?.keys() ?? [])].map((p) => p.split('/').pop()!));
  const rows = (g: string) => [...(docs.get(g)?.values() ?? [])];
  const users = ids('users');
  const studies = ids('studies');
  const participations = ids('participations');
  const evidenceIds = ids('evidence');
  const tasksByStudy = new Map<string, Set<string>>();
  for (const p of docs.get('studies/*/tasks')?.keys() ?? []) {
    const [, sid, , tid] = p.split('/');
    tasksByStudy.set(sid!, (tasksByStudy.get(sid!) ?? new Set()).add(tid!));
  }
  const relations: Manifest['relations'] = [];
  const check = (name: string, items: unknown[], ok: (x: Data) => boolean) => relations.push({ check: name, total: items.length, unresolved: (items as Data[]).filter((x) => !ok(x)).length });
  check('users have an email guard', rows('users'), (u) => docs.get('userEmails')?.get(`userEmails/${sha(String(u.email))}`)?.userId === u.id);
  check('no password hash in Firestore', rows('users'), (u) => u.password_hash === null);
  check('non-admin users carry migrated_link, admins never', rows('users'), (u) => (u.role === 'admin' ? !('migrated_link' in u) : u.migrated_link === 'verified_email'));
  check('studies.builder_id -> users', rows('studies'), (s) => users.has(String(s.builder_id)));
  check('tasks -> parent study', rows('studies/*/tasks'), (t) => studies.has(String(t.study_id)));
  check('participations.study_id -> studies', rows('participations'), (p) => studies.has(String(p.study_id)));
  check('participations.tester_id -> users', rows('participations'), (p) => users.has(String(p.tester_id)));
  check('participations.decided_by -> users', rows('participations'), (p) => p.decided_by === null || users.has(String(p.decided_by)));
  check('participations have their pair guard', rows('participations'), (p) => docs.get('participationPairs')?.get(`participationPairs/${p.study_id}_${p.tester_id}`)?.participation_id === p.id);
  check('studies.join_seq = participations', rows('studies'), (s) => s.join_seq === rows('participations').filter((p) => p.study_id === s.id).length);
  check('notes -> task of the study', [...(docs.get('participations/*/notes')?.entries() ?? [])].map(([path, d]) => ({ ...d, pid: path.split('/')[1] })), (n) => {
    const p = docs.get('participations')?.get(`participations/${n.pid}`);
    return !!p && !!tasksByStudy.get(String(p.study_id))?.has(String(n.task_id));
  });
  check('findings -> participation, evidence, author', rows('findings'), (f) => participations.has(String(f.participation_id)) && (f.evidence_id === null || evidenceIds.has(String(f.evidence_id))) && users.has(String(f.created_by)));
  check('disputes -> participation, opener, guard', rows('disputes'), (d) => participations.has(String(d.participation_id)) && users.has(String(d.opened_by)) && docs.get('disputeByParticipation')?.get(`disputeByParticipation/${d.participation_id}`)?.dispute_id === d.id);
  const owner = (account: string) => (account === FAUCET ? true : account.startsWith('user:') ? users.has(account.slice(5)) : account.startsWith('study:') ? studies.has(account.slice(6)) : false);
  check('ledger -> account owner, study, participation', rows('ledger'), (e) => owner(String(e.account)) && (e.study_id === null || studies.has(String(e.study_id))) && (e.participation_id === null || participations.has(String(e.participation_id))));
  check('evidence -> participation, segment guard', rows('evidence'), (e) => participations.has(String(e.participation_id)) && docs.get('evidenceSegments')?.get(`evidenceSegments/${e.participation_id}:${sha(String(e.client_segment_id))}`)?.evidence_id === e.id);
  check('evidence usage = evidence rows', rows('evidence'), (e) => {
    const u = docs.get('evidenceUsage')?.get(`evidenceUsage/${e.participation_id}`);
    const mine = rows('evidence').filter((x) => x.participation_id === e.participation_id);
    return !!u && u.evidence_count === mine.length && u.evidence_bytes === mine.reduce((s, x) => s + Number(x.size_bytes), 0);
  });
  check('app evidence keys registered (storageObjects)', rows('evidence').filter((e) => String(e.storage_key).startsWith('evidence/')), (e) => docs.get('storageObjects')?.get(`storageObjects/${sha(String(e.storage_key))}`)?.object_key === e.storage_key);
  check('walletLinks -> users, address guard', rows('walletLinks'), (w) => users.has(String(w.user_id)) && docs.get('walletAddresses')?.get(`walletAddresses/${w.address}`)?.user_id === w.user_id);
  check('identities -> users', rows('identities'), (i) => users.has(String(i.user_id)));

  // Ledger reconciliation: entries per account = its running total (balance, by kind, seq).
  const entries = rows('ledger');
  let mismatches = 0;
  for (const a of rows('accounts')) {
    const mine = entries.filter((e) => e.account === a.account);
    const byKind: Record<string, number> = {};
    for (const e of mine) byKind[String(e.kind)] = (byKind[String(e.kind)] ?? 0) + Number(e.amount);
    if (mine.reduce((s, e) => s + Number(e.amount), 0) !== a.balance || canonical(byKind) !== canonical(a.by_kind) || mine.length !== a.seq) mismatches += 1;
  }
  const accountsWithEntries = new Set(entries.map((e) => String(e.account)).filter((x) => x !== FAUCET));
  if (accountsWithEntries.size !== rows('accounts').length) mismatches += 1;
  const sums: Record<string, number> = {};
  for (const e of entries) sums[String(e.account)] = (sums[String(e.account)] ?? 0) + Number(e.amount);
  const ledger = {
    accounts: rows('accounts').length,
    mismatches,
    totalSum: entries.reduce((s, e) => s + Number(e.amount), 0),
    faucet: sums[FAUCET] ?? 0,
    matchesSource: canonical(sums) === canonical(plan.sourceLedger),
  };

  const seekerPlan = seeker ? plan.evidence.find((e) => e.evidenceId === seeker.evidenceId)! : null;
  const seekerOut = seekerPlan
    ? {
        evidenceId: seekerPlan.evidenceId,
        action: seekerPlan.action,
        sourceKey: seekerPlan.sourceKey,
        targetKey: seekerPlan.targetKey,
        expectedSha256: seekerPlan.expectedSha256,
        participationFound: participations.has(seekerPlan.participationId),
        testerFound: users.has(String(docs.get('participations')?.get(`participations/${seekerPlan.participationId}`)?.tester_id)),
        evidenceDocPointsAtTarget: docs.get('evidence')?.get(`evidence/${seekerPlan.evidenceId}`)?.storage_key === seekerPlan.targetKey,
        targetRegistered: !!docs.get('storageObjects')?.get(`storageObjects/${sha(seekerPlan.targetKey)}`),
        archiveRegistered: !!docs.get('storageObjects')?.get(`storageObjects/${sha(seekerPlan.sourceKey)}`),
        // storage/r2.ts presignGet signs only evidence/ and quarantine/ keys.
        playbackPrefixAllowed: /^(evidence|quarantine)\//.test(seekerPlan.targetKey),
      }
    : null;

  const manifest: Manifest = {
    tool: TOOL_VERSION,
    snapshotSha256,
    source: { tables: plan.sourceCounts, skipped: plan.skipped, passwordHashesDropped: plan.passwordHashesDropped },
    users: {
      migratedLinkPlanned: plan.migratedLinkUsers,
      migratedLinkFound: rows('users').filter((u) => u.migrated_link === 'verified_email').length,
      adminsExcluded: plan.adminsExcluded,
    },
    target: { collections },
    relations,
    ledger,
    evidence: {
      objects: plan.evidence,
      uploads: plan.evidence.filter((e) => e.action === 'upload-copy').length,
      serverCopies: plan.evidence.filter((e) => e.action === 'server-copy').length,
      totalBytes: plan.evidence.reduce((s, e) => s + e.bytes, 0),
    },
    seeker: seekerOut,
    ok:
      Object.values(collections).every((c) => c.matchesPlan && c.planned === c.found) &&
      relations.every((r) => r.unresolved === 0) &&
      ledger.mismatches === 0 &&
      ledger.totalSum === 0 &&
      ledger.matchesSource &&
      plan.migratedLinkUsers === rows('users').filter((u) => u.migrated_link === 'verified_email').length &&
      rows('users').every((u) => u.role !== 'admin' || !('migrated_link' in u)) &&
      (!seekerOut ||
        (seekerOut.action === 'server-copy' &&
          seekerOut.participationFound &&
          seekerOut.testerFound &&
          seekerOut.evidenceDocPointsAtTarget &&
          seekerOut.targetRegistered &&
          !seekerOut.archiveRegistered &&
          seekerOut.playbackPrefixAllowed)),
  };
  return { ...manifest, manifestSha256: sha(canonical(manifest)) };
}

/** Local media hashes by storage key, from the media directory (read-only). */
export function mediaHasher(dir: string) {
  return (key: string) => {
    if (!/^[\w-]+$/.test(key)) return null; // local keys are bare ids; never follow a path
    const p = join(dir, key);
    return existsSync(p) ? sha(readFileSync(p)) : null;
  };
}

function outsideRepo(file: string): boolean {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  let probe = dirname(resolve(file));
  while (!existsSync(probe)) probe = dirname(probe);
  const rel = relative(realpathSync(repoRoot), realpathSync(probe));
  return rel.startsWith('..') || isAbsolute(rel);
}

// ── Real run: object storage (no delete exists here) ─────────────────────────────────────

/** The only object operations the real run needs. There is deliberately no delete. */
export type ObjectStore = {
  head(key: string): Promise<{ size: number } | null>;
  /** sha256 of the whole object (a full GET). */
  sha256(key: string): Promise<string>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  copy(srcKey: string, dstKey: string): Promise<void>;
};
export type R2Target = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

/** Writes land only at the app's own evidence/{id} keys. */
const APP_KEY = /^evidence\/[A-Za-z0-9_-]{8,64}$/;
const ARCHIVE_KEY = /^retained-local-submissions\/[A-Za-z0-9_-]{8,64}\/[0-9a-f]{64}\.mp4$/;

/** S3-compatible client for R2 (same client settings as storage/r2.ts). PUTs go through a presigned URL. */
export function s3ObjectStore(r2: R2Target): ObjectStore {
  const client = new S3Client({ region: 'auto', endpoint: r2.endpoint, forcePathStyle: true, credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey } });
  const Bucket = r2.bucket;
  const missing = (e: unknown) => {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404;
  };
  const appKey = (key: string) => {
    if (!APP_KEY.test(key)) throw new Error('refusing to write outside evidence/{id}');
  };
  return {
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(r.ContentLength ?? 0) };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async sha256(key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      const h = createHash('sha256');
      for await (const c of r.Body as Readable) h.update(c as Buffer);
      return h.digest('hex');
    },
    async put(key, body, contentType) {
      appKey(key);
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: body.length }), {
        expiresIn: 900,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType, 'content-length': String(body.length) }, body: new Uint8Array(body) });
      if (!res.ok) throw new Error(`PUT failed with HTTP ${res.status}`);
    },
    async copy(srcKey, dstKey) {
      appKey(dstKey);
      if (!ARCHIVE_KEY.test(srcKey)) throw new Error('refusing to copy from a key that is not a retained archive');
      await client.send(new CopyObjectCommand({ Bucket, Key: dstKey, CopySource: `${Bucket}/${srcKey}` }));
    },
  };
}

/** R2 settings from the environment (names as in config.ts). A test endpoint only for demo- targets. */
export function r2FromEnv(env: NodeJS.ProcessEnv, allowTestEndpoint: boolean): R2Target {
  const accountId = env.POCKETQA_R2_ACCOUNT_ID ?? '';
  const bucket = env.POCKETQA_R2_BUCKET ?? '';
  const accessKeyId = env.POCKETQA_R2_ACCESS_KEY_ID ?? '';
  const secretAccessKey = env.POCKETQA_R2_SECRET_ACCESS_KEY ?? '';
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('refusing: POCKETQA_R2_ACCOUNT_ID (32 hex) is required');
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)) throw new Error('refusing: POCKETQA_R2_BUCKET is required');
  if (!accessKeyId || !secretAccessKey) throw new Error('refusing: POCKETQA_R2_ACCESS_KEY_ID and POCKETQA_R2_SECRET_ACCESS_KEY are required');
  let endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  if (env.POCKETQA_R2_ENDPOINT) {
    if (!allowTestEndpoint) throw new Error('refusing: POCKETQA_R2_ENDPOINT (a test server) is not allowed for the real project');
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.POCKETQA_R2_ENDPOINT)) throw new Error('refusing: POCKETQA_R2_ENDPOINT may only be a loopback test server');
    endpoint = env.POCKETQA_R2_ENDPOINT;
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

// ── Real run: the steps ──────────────────────────────────────────────────────────────

export class Refused extends Error {}

export type RealRunReport = {
  approvedManifest: string;
  plannedManifest: string;
  preCheck: { plannedDocs: number; existingIdentical: number; existingConflicting: number; unplannedUsers: number };
  objects: { alreadyPresent: number; uploaded: number; serverCopied: number; registered: number; failed: { evidenceId: string; reason: string } | null };
  docsWritten: number;
  postManifest: string | null;
  postMatchesApproved: boolean;
};

/**
 * The real migration (plan §8.3–8.5): refuse unless the plan reproduces the approved manifest and
 * the target holds nothing that conflicts; then objects (verify, then register), then documents,
 * then the post-run manifest read back from the target.
 */
export async function realRun(o: {
  fs: Firestore;
  store: ObjectStore;
  plan: Plan;
  snapshotSha256: string;
  seeker: SeekerReceipt;
  approvedSha256: string;
  mediaDir: string;
}): Promise<{ report: RealRunReport; manifest: Manifest | null }> {
  const { fs, store, plan, seeker } = o;
  const planned = plannedManifest(plan, o.snapshotSha256, seeker);
  if (!planned.ok) throw new Refused('refusing: the planned manifest is not ok');
  if (planned.manifestSha256 !== o.approvedSha256) throw new Refused(`refusing: the planned manifest ${planned.manifestSha256!.slice(0, 12)}… is not the approved ${o.approvedSha256.slice(0, 12)}…`);
  const report: RealRunReport = {
    approvedManifest: o.approvedSha256,
    plannedManifest: planned.manifestSha256!,
    preCheck: { plannedDocs: plan.writes.length, existingIdentical: 0, existingConflicting: 0, unplannedUsers: 0 },
    objects: { alreadyPresent: 0, uploaded: 0, serverCopied: 0, registered: 0, failed: null },
    docsWritten: 0,
    postManifest: null,
    postMatchesApproved: false,
  };

  // Pre-check (read only): no unplanned users; every planned doc absent or identical.
  const plannedUsers = new Set(plan.writes.filter((w) => w.path.startsWith('users/')).map((w) => w.path.slice('users/'.length)));
  report.preCheck.unplannedUsers = (await fs.collection('users').select().get()).docs.filter((d) => !plannedUsers.has(d.id)).length;
  const conflicts = new Set<string>();
  for (let i = 0; i < plan.writes.length; i += 300) {
    const part = plan.writes.slice(i, i + 300);
    const snaps = await fs.getAll(...part.map((w) => fs.doc(w.path)));
    snaps.forEach((s, j) => {
      if (!s.exists) return;
      if (canonical(s.data()) === canonical(part[j]!.data)) report.preCheck.existingIdentical += 1;
      else {
        report.preCheck.existingConflicting += 1;
        conflicts.add(groupOf(part[j]!.path));
      }
    });
  }
  if (report.preCheck.unplannedUsers > 0) throw Object.assign(new Refused(`refusing: the target holds ${report.preCheck.unplannedUsers} user(s) this migration doesn't plan`), { report });
  if (conflicts.size > 0) throw Object.assign(new Refused(`refusing: ${report.preCheck.existingConflicting} planned document(s) exist with different content (${[...conflicts].sort().join(', ')})`), { report });

  // Objects, then their registration. The archive key is only ever a copy source.
  const docByPath = new Map(plan.writes.map((w) => [w.path, w.data]));
  for (const e of plan.evidence) {
    const fail = (reason: string) => {
      report.objects.failed = { evidenceId: e.evidenceId, reason };
      return Object.assign(new Error(`stopped: evidence ${e.evidenceId}: ${reason} (left unregistered)`), { report });
    };
    if (!APP_KEY.test(e.targetKey) || e.targetKey === seeker.key) throw fail('target is not an app evidence key');
    const existing = await store.head(e.targetKey);
    if (existing) {
      if (existing.size !== e.bytes || (await store.sha256(e.targetKey)) !== e.expectedSha256) throw fail('the target already holds different content');
      report.objects.alreadyPresent += 1;
    } else if (e.action === 'upload-copy') {
      if (!/^[\w-]+$/.test(e.sourceKey)) throw fail('unsafe local media name');
      const body = readFileSync(join(o.mediaDir, e.sourceKey));
      if (sha(body) !== e.expectedSha256) throw fail('the local media no longer matches its planned sha256');
      const mime = String(docByPath.get(`evidence/${e.evidenceId}`)?.mime_type ?? '');
      await store.put(e.targetKey, body, mime);
      report.objects.uploaded += 1;
    } else {
      if (e.sourceKey !== seeker.key || !ARCHIVE_KEY.test(e.sourceKey)) throw fail('server-copy source is not the receipt archive key');
      const archive = await store.head(seeker.key);
      if (!archive || archive.size !== seeker.bytes) throw fail('the archive object is missing or its size differs from the receipt');
      await store.copy(seeker.key, e.targetKey);
      report.objects.serverCopied += 1;
    }
    const after = await store.head(e.targetKey);
    if (!after || after.size !== e.bytes) throw fail('size verification failed');
    if ((await store.sha256(e.targetKey)) !== e.expectedSha256) throw fail('sha256 verification failed');
    const path = `storageObjects/${sha(e.targetKey)}`;
    await fs.doc(path).set(docByPath.get(path)!);
    report.objects.registered += 1;
  }

  // Documents (deterministic, so a rerun rewrites identical content), then the read-back manifest.
  await applyPlan(fs, plan);
  report.docsWritten = plan.writes.length;
  const manifest = await buildManifest(fs, plan, o.snapshotSha256, seeker);
  report.postManifest = manifest.manifestSha256!;
  report.postMatchesApproved = manifest.manifestSha256 === o.approvedSha256;
  return { report, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const real = args.includes('--real');
  const approved = opt('--approved-manifest');
  if (real && (!approved || !/^[0-9a-f]{64}$/.test(approved))) throw new Error('refusing: --real needs --approved-manifest <sha256 of the QA-approved dry-run manifest>');
  const snapshot = opt('--snapshot');
  const expect = opt('--expect-sha256');
  const mediaDir = opt('--media-dir');
  const receiptFile = opt('--receipt') ?? DEFAULT_RECEIPT;
  // The receipt comes from the 0600 migration dir; nothing under .preview is ever read.
  if (resolve(receiptFile).split('/').includes('.preview')) throw new Error('refusing: the receipt must not be read from .preview');
  const out = opt('--out');
  if (!snapshot || !expect || !mediaDir || !out) {
    throw new Error('usage: [--real --approved-manifest <sha256> [--project <id>]] --snapshot <copy.sqlite> --expect-sha256 <hex> --media-dir <copy/media> [--receipt <seeker-receipt.json>] --out <manifest.json outside the repo>');
  }
  const project = real ? (opt('--project') ?? REAL_PROJECT) : 'demo-pocketqa';
  if (real) {
    if (project !== REAL_PROJECT && !project.startsWith('demo-')) throw new Error(`refusing: the real run targets ${REAL_PROJECT} (or a demo- emulator project in tests)`);
    if (project === REAL_PROJECT && expect !== REAL_SNAPSHOT_SHA256) throw new Error('refusing: the real project accepts only the approved snapshot');
    if (project === REAL_PROJECT && process.env.FIRESTORE_EMULATOR_HOST) throw new Error('refusing: FIRESTORE_EMULATOR_HOST is set for a real-project run');
    if (project.startsWith('demo-') && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('refusing: a demo- project runs only on the emulator');
  } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('refusing: the dry run writes only to the Firestore emulator (FIRESTORE_EMULATOR_HOST is not set)');
  }
  if (!outsideRepo(out)) throw new Error('refusing: the manifest must be written outside the repository');
  if (!existsSync(receiptFile)) throw new Error('refusing: the Seeker receipt is missing (default ~/.local/share/pocketqa/migration/seeker-receipt.json, or --receipt)');
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8')) as SeekerReceipt;
  const seeker: SeekerReceipt = { evidenceId: receipt.evidenceId, key: receipt.key, sha256: receipt.sha256, bytes: receipt.bytes };
  const r2 = real ? r2FromEnv(process.env, project.startsWith('demo-')) : null;
  if (r2 && receipt.bucket && receipt.bucket !== r2.bucket) throw new Error('refusing: POCKETQA_R2_BUCKET is not the bucket of the Seeker archive');

  const db = openSnapshot(snapshot, expect);
  const plan = planMigration(db, { mediaSha256: mediaHasher(mediaDir), seeker });
  db.close();
  const fs = openFirestore(process.env, project);

  let manifest: Manifest;
  if (real) {
    try {
      const run = await realRun({ fs, store: s3ObjectStore(r2!), plan, snapshotSha256: expect, seeker, approvedSha256: approved!, mediaDir });
      manifest = run.manifest!;
      writeFileSync(`${out}.report.json`, `${JSON.stringify(run.report, null, 2)}\n`, { mode: 0o600 });
      const r = run.report;
      console.log(`real run ${project}: pre-check ${r.preCheck.plannedDocs} planned, ${r.preCheck.existingIdentical} already identical, 0 conflicting, 0 unplanned users`);
      console.log(`objects: ${r.objects.uploaded} uploaded, ${r.objects.serverCopied} server-copied, ${r.objects.alreadyPresent} already present, ${r.objects.registered} verified and registered`);
      console.log(`documents written: ${r.docsWritten}`);
      console.log(`post-run manifest ${r.postManifest} ${r.postMatchesApproved ? 'MATCHES' : 'DOES NOT MATCH'} the approved ${approved}`);
      if (!r.postMatchesApproved) process.exitCode = 1;
    } catch (e) {
      const report = (e as { report?: RealRunReport }).report;
      if (report) writeFileSync(`${out}.report.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      throw e;
    }
  } else {
    await applyPlan(fs, plan);
    manifest = await buildManifest(fs, plan, expect, seeker);
  }
  // The snapshot copy is unchanged by the run.
  if (sha(readFileSync(snapshot)) !== expect) throw new Error('the snapshot changed during the run');
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  // Counts only (never user content, emails or keys).
  const c = manifest.target.collections;
  console.log(`snapshot ${expect.slice(0, 12)}… tables ${Object.keys(manifest.source.tables).length}, skipped ${Object.keys(manifest.source.skipped).length}`);
  for (const [g, v] of Object.entries(c)) console.log(`  ${g.padEnd(26)} planned ${String(v.planned).padStart(4)} found ${String(v.found).padStart(4)} ${v.matchesPlan ? 'checksum ok' : 'CHECKSUM MISMATCH'}`);
  console.log(`relations: ${manifest.relations.length} checks, ${manifest.relations.reduce((s, r) => s + r.unresolved, 0)} unresolved`);
  console.log(`ledger: ${manifest.ledger.accounts} accounts, ${manifest.ledger.mismatches} mismatches, sum ${manifest.ledger.totalSum}, matches source ${manifest.ledger.matchesSource}`);
  console.log(`users: ${manifest.users.migratedLinkFound}/${manifest.users.migratedLinkPlanned} carry migrated_link, ${manifest.users.adminsExcluded} admin(s) excluded`);
  console.log(`evidence: ${manifest.evidence.uploads} uploads planned, ${manifest.evidence.serverCopies} server copy(ies), ${manifest.evidence.totalBytes} bytes`);
  if (manifest.seeker) {
    const k = manifest.seeker;
    console.log(`seeker: ${k.action}, participation ${k.participationFound}, tester ${k.testerFound}, doc->target ${k.evidenceDocPointsAtTarget}, target registered ${k.targetRegistered}, archive registered ${k.archiveRegistered}, playback ${k.playbackPrefixAllowed}`);
  }
  console.log(`ok ${manifest.ok}  manifest ${manifest.manifestSha256}`);
  if (!manifest.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
