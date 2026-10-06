import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyPlan, buildManifest, mediaHasher, openSnapshot, planMigration, type SeekerReceipt } from '../../scripts/migrate-to-firestore';
import { openDb } from '../../src/db';
import { firestoreStudiesRepo } from '../../src/repo/studies/firestore';
import { clearEmulator, emulatorFirestore } from './fs';

// Migration dry run (plan §8 steps 1–3) against a SYNTHETIC snapshot built here: the tests never
// read real data. The real snapshot is migrated only by the CLI, into a throwaway emulator.
const fs = emulatorFirestore();
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
let dir: string;
let snapshot: string;
let snapshotSha: string;
let media: string;
let seeker: SeekerReceipt;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pqa-migrate-'));
  media = join(dir, 'media');
  mkdirSync(media);
  snapshot = join(dir, 'snapshot.sqlite');
  const db = openDb(snapshot);
  const at = '2026-10-05T10:00:00.000Z';
  const ins = (sql: string, ...v: unknown[]) => db.prepare(sql).run(...v);
  for (const [id, role, status] of [['b1', 'builder', 'active'], ['t1', 'tester', 'active'], ['t2', 'tester', 'active'], ['a1', 'admin', 'active'], ['gone', 'tester', 'deleted']] as const) {
    ins('INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (?,?,?,?,?,?,?,?)', id, `${id}@example.test`, 'scrypt$hash', `User ${id}`, role, status, null, at);
  }
  ins(`INSERT INTO identities (provider, subject, user_id, has_recovery, valid_after_ms, created_at) VALUES ('firebase','uid-t1','t1',1,0,?)`, at);
  ins(`INSERT INTO studies (id, builder_id, title, objective, build_under_test, device_criteria_json, reward_credits, slots, consent_text, consent_version, status, moderation, created_at, published_at, closed_at, payment_mode)
       VALUES ('s1','b1','Checkout','Find friction',NULL,'{"platforms":["web"],"minAndroidApi":null,"languages":["en"]}',10,3,'I agree.',1,'published','ok',?,?,NULL,'test_credits')`, at, at);
  ins(`INSERT INTO tasks (id, study_id, ord, instruction, success_criteria) VALUES ('k1','s1',0,'Open the app',NULL), ('k2','s1',1,'Buy','Order placed')`);
  ins(`INSERT INTO participations (id, study_id, tester_id, status, consent_version, consented_at, started_at, submitted_at, decided_at, decided_by, decision_reason, reward_credits, payout_address)
       VALUES ('p1','s1','t1','approved',1,?,?,?,?,'b1',NULL,10,NULL), ('p2','s1','t2','resolved',1,?,?,?,?,'b1','Not the checkout.',10,NULL)`, at, at, at, at, at, at, at, at);
  ins(`INSERT INTO task_notes (participation_id, task_id, note) VALUES ('p1','k1','Found the cart')`);
  // Ledger: top-up, reserve, one reward (rowid order = insertion order).
  const post = (id: string, tx: string, account: string, amount: number, kind: string, sid: string | null, pid: string | null) =>
    ins('INSERT INTO ledger (id, tx_id, account, amount, kind, study_id, participation_id, created_at) VALUES (?,?,?,?,?,?,?,?)', id, tx, account, amount, kind, sid, pid, at);
  post('l1', 'x1', 'system:test-faucet', -30, 'test_topup', null, null);
  post('l2', 'x1', 'user:b1', 30, 'test_topup', null, null);
  post('l3', 'x2', 'user:b1', -30, 'study_reserve', 's1', null);
  post('l4', 'x2', 'study:s1', 30, 'study_reserve', 's1', null);
  post('l5', 'x3', 'study:s1', -10, 'reward_credit', 's1', 'p1');
  post('l6', 'x3', 'user:t1', 10, 'reward_credit', 's1', 'p1');
  // Evidence: one app recording and one standing in for the archived Seeker recording.
  writeFileSync(join(media, 'm1'), Buffer.from('app recording bytes'));
  writeFileSync(join(media, 'm2'), Buffer.from('archived recording bytes'));
  ins(`INSERT INTO evidence (id, participation_id, kind, mime_type, size_bytes, duration_ms, task_id, captured_on, client_segment_id, storage_key, created_at)
       VALUES ('e1','p1','screen_recording','video/mp4',19,1000,'k1','web','seg/1','m1',?), ('e2','p2','screen_recording','video/mp4',24,2000,NULL,'android','seg-2','m2',?)`, at, at);
  ins(`INSERT INTO findings (id, participation_id, title, severity, description, evidence_id, timestamp_ms, created_by, created_at) VALUES ('f1','p1','Cart hidden','major','Below the fold','e1',500,'b1',?)`, at);
  ins(`INSERT INTO disputes (id, participation_id, opened_by, reason, status, outcome, resolution_note, resolved_by, created_at, resolved_at) VALUES ('d1','p2','t2','I did it','resolved','upheld','Confirmed','a1',?,?)`, at, at);
  ins(`INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES ('au1','a1','dispute.upheld','dispute','d1','Confirmed',?)`, at);
  ins(`INSERT INTO wallet_links (user_id, address, linked_at) VALUES ('t1','9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',?)`, at);
  ins(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h1','t1',?,0)`, at);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  snapshotSha = sha(readFileSync(snapshot));
  const m2 = sha(readFileSync(join(media, 'm2')));
  seeker = { evidenceId: 'e2', key: `retained-local-submissions/e2/${m2}.mp4`, sha256: m2, bytes: 24 };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(clearEmulator);

async function dryRun() {
  const db = openSnapshot(snapshot, snapshotSha);
  const plan = planMigration(db, { mediaSha256: mediaHasher(media), seeker });
  db.close();
  await applyPlan(fs, plan);
  return { plan, manifest: await buildManifest(fs, plan, snapshotSha, seeker) };
}

describe('migration dry run (plan §8)', () => {
  it('maps every row to the repositories’ documents and guards; all checks pass', async () => {
    const { manifest } = await dryRun();
    expect(manifest.ok).toBe(true);
    const c = manifest.target.collections;
    expect(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.found]))).toEqual({
      accounts: 3, // user:b1, study:s1, user:t1 (the faucet has no totals doc)
      audit: 1,
      disputeByParticipation: 1,
      disputes: 1,
      evidence: 2,
      evidenceSegments: 2,
      evidenceUsage: 2,
      findings: 1,
      identities: 1,
      ledger: 6,
      ledgerRewards: 1,
      participationPairs: 2,
      participations: 2,
      'participations/*/notes': 1,
      storageObjects: 2, // both evidence/{id} targets; never the archived key
      studies: 1,
      'studies/*/tasks': 2,
      userEmails: 5,
      userProviders: 1,
      users: 5,
      walletAddresses: 1,
      walletLinks: 1,
    });
    expect(Object.values(c).every((v) => v.matchesPlan)).toBe(true);
    expect(manifest.relations.every((r) => r.unresolved === 0)).toBe(true);
    expect(manifest.ledger).toEqual({ accounts: 3, mismatches: 0, totalSum: 0, faucet: -30, matchesSource: true });
    expect(manifest.source.passwordHashesDropped).toBe(5);
    expect(manifest.source.skipped.sessions?.rows).toBe(1);
    // Admins are never claimable by email (plan §7(b): the audited admin-link script only).
    expect(manifest.users).toEqual({ migratedLinkPlanned: 4, migratedLinkFound: 4, adminsExcluded: 1 });
    expect((await fs.doc('users/a1').get()).data()).not.toHaveProperty('migrated_link');
    expect((await fs.doc('users/b1').get()).data()).toMatchObject({ migrated_link: 'verified_email' });
    expect(manifest.evidence.objects.find((e) => e.evidenceId === 'e1')).toMatchObject({ action: 'upload-copy', sourceKey: 'm1', targetKey: 'evidence/e1' });
    // The archived recording: a planned server-side copy to the app key, verified against the receipt.
    expect(manifest.seeker).toEqual({
      evidenceId: 'e2',
      action: 'server-copy',
      sourceKey: seeker.key,
      targetKey: 'evidence/e2',
      expectedSha256: seeker.sha256,
      participationFound: true,
      testerFound: true,
      evidenceDocPointsAtTarget: true,
      targetRegistered: true,
      archiveRegistered: false,
      playbackPrefixAllowed: true,
    });
    expect((await fs.doc('users/t1').get()).data()).toMatchObject({ migrated_link: 'verified_email', password_hash: null });
  });

  it('the migrated documents are what the studies repository reads (same shapes)', async () => {
    await dryRun();
    const repo = firestoreStudiesRepo(fs);
    expect((await repo.findParticipation('s1', 't1'))?.id).toBe('p1');
    expect((await repo.tasksOf('s1')).map((t) => t.id)).toEqual(['k1', 'k2']);
    expect(await repo.accountBalance('user:t1')).toBe(10);
    expect(await repo.accountBalance('system:test-faucet')).toBe(-30);
    expect((await repo.ledgerEntries('user:b1')).map((e) => e.kind)).toEqual(['study_reserve', 'test_topup']);
    expect(await repo.slotsFilled('s1')).toBe(2);
    expect((await repo.listDisputesByStudy('s1')).map((d) => d.id)).toEqual(['d1']);
    // The guard blocks a second reward exactly as for repo-written data.
    expect((await fs.doc('ledgerRewards/p1:reward_credit').get()).exists).toBe(true);
  });

  it('a rerun is idempotent: identical documents and an identical manifest', async () => {
    const first = (await dryRun()).manifest;
    const second = (await dryRun()).manifest;
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(second).toEqual(first);
  });

  it('the snapshot copy is opened immutable: unchanged, no side files', async () => {
    await dryRun();
    expect(sha(readFileSync(snapshot))).toBe(snapshotSha);
    expect(readdirSync(dir).filter((f) => f.startsWith('snapshot.sqlite-'))).toEqual([]);
  });

  it('refuses a snapshot whose sha256 differs, and a Seeker receipt that does not match the media', async () => {
    expect(() => openSnapshot(snapshot, '0'.repeat(64))).toThrow(/sha256 mismatch/);
    const db = openSnapshot(snapshot, snapshotSha);
    expect(() => planMigration(db, { mediaSha256: mediaHasher(media), seeker: { ...seeker, sha256: 'f'.repeat(64) } })).toThrow(/receipt does not match/);
    db.close();
  });

  it('the CLI refuses the real run, and a dry run without the emulator', () => {
    const run = (args: string[], env: NodeJS.ProcessEnv) => {
      try {
        execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-to-firestore.ts', ...args], { cwd: join(__dirname, '..', '..'), env, stdio: 'pipe' });
        return 'exit 0';
      } catch (e) {
        return String((e as { stderr: Buffer }).stderr);
      }
    };
    const noEmu = { ...process.env, FIRESTORE_EMULATOR_HOST: '' };
    expect(run(['--real'], process.env)).toMatch(/--real needs --approved-manifest/);
    expect(run(['--real', '--approved-manifest', 'a'.repeat(64)], process.env)).toMatch(/hosted migration is not enabled/);
    expect(run(['--snapshot', snapshot, '--expect-sha256', snapshotSha, '--media-dir', media, '--out', join(dir, 'm.json')], noEmu)).toMatch(/only to the Firestore emulator/);
    expect(run(['--snapshot', snapshot, '--expect-sha256', snapshotSha, '--media-dir', media, '--receipt', '/x/.preview/handoff/r.json', '--out', join(dir, 'm.json')], process.env)).toMatch(/must not be read from \.preview/);
  }, 60_000);
});
