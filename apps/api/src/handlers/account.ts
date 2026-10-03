import { CONTRACT_VERSION, CREDITS_DISCLAIMER, Email } from '@pocket-qa/contracts';
import { planTopUp, userAccount } from '@pocket-qa/domain';
import { accountBalance, post } from '../ledger';
import { me, type Ctx, type Handler } from '../context';
import { RECOVERABLE_PROVIDERS } from '../identity/types';
import { deleteOrQueue } from '../storage/sweep';
import { fail, hashPassword, iso, newId, newToken, sha256, verifyPassword } from '../util';
import {
  disputeView,
  evidenceView,
  findingView,
  participationView,
  studyView,
  userView,
  type EvidenceRow,
  type ParticipationRow,
  type StudyRow,
  type UserRow,
} from '../views';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// Simple in-memory brute-force brake for the local MVP: 10 failures per email per 15 min.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(newToken()));

export function issueSession(ctx: Ctx, user: UserRow) {
  const token = newToken();
  const now = ctx.deps.now();
  ctx.deps.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), user.id, iso(now), now + SESSION_TTL_MS);
  return { token, user: userView(ctx.deps.db, user) };
}

/** One account system per deployment: managed identity replaces local passwords (ADR 0005). */
function assertLocalAuth(ctx: Ctx) {
  if (ctx.deps.config.authMode !== 'local') {
    throw fail('CONFLICT_STATE', 'This deployment uses managed sign-in (email, Google or wallet).');
  }
}

/** Provider subjects (Firebase UIDs) mapped to this user. */
function identitySubjects(ctx: Ctx, userId: string): string[] {
  return (ctx.deps.db.prepare(`SELECT subject FROM identities WHERE provider = 'firebase' AND user_id = ?`).all(userId) as { subject: string }[]).map((r) => r.subject);
}

function creditsView(ctx: Ctx, userId: string) {
  const rows = ctx.deps.db
    .prepare('SELECT id, kind, amount, study_id, participation_id, created_at FROM ledger WHERE account = ? ORDER BY created_at DESC, rowid DESC')
    .all(userAccount(userId)) as { id: string; kind: never; amount: number; study_id: string | null; participation_id: string | null; created_at: string }[];
  return {
    balance: accountBalance(ctx.deps.db, userAccount(userId)),
    entries: rows.map((r) => ({ id: r.id, kind: r.kind, amount: r.amount, studyId: r.study_id, participationId: r.participation_id, createdAt: r.created_at })),
    disclaimer: CREDITS_DISCLAIMER,
  };
}

export const accountHandlers = {
  health: () => ({ ok: true as const, contractVersion: CONTRACT_VERSION }),

  clientConfig: (ctx) => {
    const { authMode, firebase } = ctx.deps.config;
    return {
      authMode,
      storage: ctx.deps.config.storage,
      walletLogin: ctx.deps.config.walletLogin,
      firebase: firebase
        ? {
            apiKey: firebase.webApiKey,
            authDomain: firebase.authDomain,
            projectId: firebase.projectId,
            authEmulatorUrl: firebase.authEmulatorHost ? `http://${firebase.authEmulatorHost}` : null,
          }
        : null,
    };
  },

  /**
   * First sign-in with a managed identity. Returns the mapped account, or creates one only
   * when asked with a self-serve role. Never merges with an existing account by email.
   */
  identitySession: async (ctx) => {
    const id = ctx.identity!;
    const db = ctx.deps.db;
    if (ctx.user) return { user: userView(db, ctx.user) };
    const mapped = db.prepare(`SELECT 1 FROM identities WHERE provider = 'firebase' AND subject = ?`).get(id.uid);
    if (mapped) throw fail('CONFLICT_STATE', 'This sign-in belongs to a deleted account.');
    // Check the identity itself first, so an unverified sign-in hears "verify your email"
    // instead of being offered an account it can't create yet.
    // Custom-token identities come only from wallet login, which creates its own accounts.
    if (id.signInProvider === 'custom') throw fail('CONFLICT_STATE', 'Use wallet sign-in to create a wallet account.');
    // Every provider must prove the email, so nobody can claim someone else's address.
    if (!id.emailVerified) throw fail('EMAIL_UNVERIFIED', 'Verify your email address, then sign in again.');
    if (!RECOVERABLE_PROVIDERS.has(id.signInProvider)) throw fail('PROVIDER_UNSUPPORTED', 'This sign-in method is not supported. Use email or Google.');
    if (!ctx.body.newAccount) throw fail('NOT_FOUND', 'No Pocket QA account uses this sign-in yet.');
    const email = Email.safeParse(id.email ?? '');
    if (!email.success) throw fail('VALIDATION', 'This sign-in has no usable email address.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.data)) {
      throw fail('CONFLICT_STATE', 'An account with this email already exists. Accounts are never merged automatically.');
    }
    const now = iso(ctx.deps.now());
    const row: UserRow = {
      id: newId(),
      email: email.data,
      password_hash: null,
      display_name: ctx.body.newAccount.displayName,
      role: ctx.body.newAccount.role,
      status: 'active',
      device_json: null,
      created_at: now,
    };
    db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (@id,@email,@password_hash,@display_name,@role,@status,@device_json,@created_at)',
      ).run(row);
      db.prepare(`INSERT INTO identities (provider, subject, user_id, has_recovery, created_at) VALUES ('firebase', ?, ?, 1, ?)`).run(id.uid, row.id, now);
    })();
    return { user: userView(db, row) };
  },

  register: async (ctx) => {
    assertLocalAuth(ctx);
    const { email, password, displayName, role } = ctx.body;
    const db = ctx.deps.db;
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw fail('CONFLICT_STATE', 'An account with this email already exists.');
    }
    const row: UserRow = {
      id: newId(),
      email,
      password_hash: await hashPassword(password),
      display_name: displayName,
      role,
      status: 'active',
      device_json: null,
      created_at: iso(ctx.deps.now()),
    };
    db.prepare(
      'INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (@id,@email,@password_hash,@display_name,@role,@status,@device_json,@created_at)',
    ).run(row);
    return issueSession(ctx, row);
  },

  login: async (ctx) => {
    assertLocalAuth(ctx);
    const { email, password } = ctx.body;
    const now = ctx.deps.now();
    const f = failures.get(email);
    if (f && now - f.first < LOGIN_WINDOW_MS && f.count >= LOGIN_MAX_FAILURES) {
      throw fail('RATE_LIMITED', 'Too many failed sign-in attempts. Try again later.');
    }
    const row = ctx.deps.db.prepare(`SELECT * FROM users WHERE email = ? AND status != 'deleted'`).get(email) as UserRow | undefined;
    // Unknown emails still pay for one argon2 verify, so timing doesn't reveal which accounts exist.
    const ok = await verifyPassword(row?.password_hash ?? (await dummyHash()), password);
    if (!row || !ok) {
      if (failures.size > 10_000) {
        for (const [k, v] of failures) if (now - v.first >= LOGIN_WINDOW_MS) failures.delete(k);
      }
      const cur = f && now - f.first < LOGIN_WINDOW_MS ? f : { count: 0, first: now };
      failures.set(email, { count: cur.count + 1, first: cur.first });
      throw fail('UNAUTHENTICATED', 'Email or password is incorrect.');
    }
    failures.delete(email);
    return issueSession(ctx, row);
  },

  logout: async (ctx) => {
    const header = ctx.req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const db = ctx.deps.db;
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    // Playback URLs handed out during this session stop working too.
    db.prepare('DELETE FROM playback_tokens WHERE user_id = ?').run(me(ctx).id);
    // Managed identity: logout is global (every device). Refuse this and older ID tokens
    // server-side at once, then revoke the provider's refresh tokens. A provider failure is
    // logged, not surfaced: the server-side revocation is already in force.
    if (ctx.deps.identity) {
      db.prepare(`UPDATE identities SET valid_after_ms = ? WHERE provider = 'firebase' AND user_id = ?`).run(ctx.deps.now(), me(ctx).id);
      for (const uid of identitySubjects(ctx, me(ctx).id)) {
        await ctx.deps.identity.revokeSessions(uid).catch(() => ctx.req.log.warn('identity provider revocation failed; server-side revocation applied'));
      }
    }
    return { ok: true as const };
  },

  me: (ctx) => userView(ctx.deps.db, me(ctx)),

  putDevice: (ctx) => {
    const user = me(ctx);
    ctx.deps.db.prepare('UPDATE users SET device_json = ? WHERE id = ?').run(JSON.stringify(ctx.body), user.id);
    return userView(ctx.deps.db, { ...user, device_json: JSON.stringify(ctx.body) });
  },

  credits: (ctx) => creditsView(ctx, me(ctx).id),

  topUp: (ctx) => {
    const user = me(ctx);
    post(ctx.deps.db, planTopUp(user.id, ctx.body.amount), ctx.deps.now());
    return creditsView(ctx, user.id);
  },

  exportMe: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const studies = (db.prepare('SELECT * FROM studies WHERE builder_id = ?').all(user.id) as StudyRow[]).map((s) => studyView(db, s, ctx.deps.now()));
    const parts = db.prepare('SELECT * FROM participations WHERE tester_id = ?').all(user.id) as ParticipationRow[];
    const partIds = parts.map((p) => p.id);
    const inList = (ids: string[]) => (ids.length ? ids.map(() => '?').join(',') : `''`);
    const evidence = (db.prepare(`SELECT * FROM evidence WHERE participation_id IN (${inList(partIds)})`).all(...partIds) as EvidenceRow[]).map(evidenceView);
    // Findings the user authored (builder) or that concern their own participations (tester).
    const findings = (
      db
        .prepare(`SELECT * FROM findings WHERE created_by = ? OR participation_id IN (${inList(partIds)})`)
        .all(user.id, ...partIds) as Parameters<typeof findingView>[0][]
    ).map(findingView);
    const disputes = (db.prepare('SELECT * FROM disputes WHERE opened_by = ?').all(user.id) as Parameters<typeof disputeView>[0][]).map(disputeView);
    return {
      exportedAt: iso(ctx.deps.now()),
      user: userView(db, user),
      studies,
      participations: parts.map((p) => participationView(db, p, { withTesterName: false })),
      evidence,
      findings,
      ledger: creditsView(ctx, user.id).entries,
      disputes,
    };
  },

  /**
   * Deletion removes personal data and media. Retention exception (documented in
   * docs/decisions/0002-retention.md): ledger postings stay, keyed by the now-anonymous
   * user id, because deleting them would break other parties' budgets and balances.
   */
  deleteMe: async (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const subjects = identitySubjects(ctx, user.id);
    const live = db.prepare(`SELECT COUNT(*) AS n FROM studies WHERE builder_id = ? AND status IN ('published','paused')`).get(user.id) as { n: number };
    if (live.n > 0) throw fail('CONFLICT_STATE', 'Close your published or paused studies before deleting your account.');
    const active = db
      .prepare(`SELECT COUNT(*) AS n FROM participations WHERE tester_id = ? AND status IN ('submitted','disputed')`)
      .get(user.id) as { n: number };
    if (active.n > 0) throw fail('CONFLICT_STATE', 'Wait until your submitted work is reviewed and disputes are resolved.');

    const media: string[] = [];
    const quarantine: string[] = [];
    db.transaction(() => {
      // Evidence the user recorded, and evidence inside studies the user owns.
      const ev = db
        .prepare(
          `SELECT e.id, e.storage_key FROM evidence e JOIN participations p ON p.id = e.participation_id
           JOIN studies s ON s.id = p.study_id WHERE p.tester_id = ? OR s.builder_id = ?`,
        )
        .all(user.id, user.id) as { id: string; storage_key: string }[];
      for (const e of ev) {
        media.push(e.storage_key);
        db.prepare('UPDATE findings SET evidence_id = NULL WHERE evidence_id = ?').run(e.id);
        db.prepare('DELETE FROM evidence WHERE id = ?').run(e.id);
      }
      db.prepare('DELETE FROM task_notes WHERE participation_id IN (SELECT id FROM participations WHERE tester_id = ?)').run(user.id);
      db.prepare(`UPDATE participations SET status = CASE WHEN status IN ('consented','in_progress') THEN 'withdrawn' ELSE status END, decision_reason = NULL WHERE tester_id = ?`).run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM playback_tokens WHERE user_id = ?').run(user.id);
      db.prepare(`UPDATE disputes SET reason = '[deleted]' WHERE opened_by = ?`).run(user.id);
      // Demo transfers carry wallet addresses (on-chain pseudonyms) and no ledger value.
      db.prepare('DELETE FROM devnet_transfers WHERE builder_id = ? OR tester_id = ?').run(user.id, user.id);
      // Audit reasons about the user, or about their work (admin decisions on their
      // participations, resolutions of their disputes), are redacted; action, actor and
      // timestamp stay so the audit trail keeps its shape (ADR 0002).
      db.prepare(
        `UPDATE audit SET reason = '[redacted on account deletion]'
         WHERE (target_type = 'user' AND target_id = ?)
            OR (target_type = 'participation' AND target_id IN (SELECT id FROM participations WHERE tester_id = ?))
            OR (target_type = 'dispute' AND target_id IN (SELECT id FROM disputes WHERE opened_by = ?))`,
      ).run(user.id, user.id, user.id);
      db.prepare('DELETE FROM wallet_links WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM wallet_nonces WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM identities WHERE user_id = ?').run(user.id);
      // Open direct uploads: close them and remove their quarantine objects.
      for (const r of db.prepare(`SELECT object_key FROM upload_intents WHERE tester_id = ? AND status IN ('pending','completing')`).all(user.id) as { object_key: string }[]) {
        quarantine.push(r.object_key);
      }
      db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE tester_id = ? AND status IN ('pending','completing')`).run(user.id);
      db.prepare(
        `UPDATE users SET email = ?, password_hash = NULL, display_name = 'Deleted user', device_json = NULL, status = 'deleted' WHERE id = ?`,
      ).run(`deleted-${user.id}@deleted.invalid`, user.id);
    })();
    // Stored objects: deleted now, or retried through the outbox if the provider fails.
    for (const key of media) await deleteOrQueue(ctx.deps, key);
    for (const q of quarantine) await deleteOrQueue(ctx.deps, q);
    // After commit: the local account is gone either way. A provider failure leaves an
    // orphan provider user with no mapping (it can't reach this account); it is logged.
    if (ctx.deps.identity) {
      for (const uid of subjects) {
        await ctx.deps.identity.revokeSessions(uid).catch(() => {});
        await ctx.deps.identity.deleteUser(uid).catch(() => ctx.req.log.warn('identity provider user deletion failed; orphaned provider user'));
      }
    }
    return { ok: true as const };
  },

  aiStatus: () => ({ available: false, provider: null }),
} satisfies Record<string, Handler>;
