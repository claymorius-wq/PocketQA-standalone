import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_VERSION, CREDITS_DISCLAIMER } from '@pocket-qa/contracts';
import { planTopUp, userAccount } from '@pocket-qa/domain';
import { accountBalance, post } from '../ledger';
import { me, type Ctx, type Handler } from '../context';
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

function issueSession(ctx: Ctx, user: UserRow) {
  const token = newToken();
  const now = ctx.deps.now();
  ctx.deps.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), user.id, iso(now), now + SESSION_TTL_MS);
  return { token, user: userView(ctx.deps.db, user) };
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

  register: async (ctx) => {
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

  logout: (ctx) => {
    const header = ctx.req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const db = ctx.deps.db;
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    // Playback URLs handed out during this session stop working too.
    db.prepare('DELETE FROM playback_tokens WHERE user_id = ?').run(me(ctx).id);
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
  deleteMe: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const live = db.prepare(`SELECT COUNT(*) AS n FROM studies WHERE builder_id = ? AND status IN ('published','paused')`).get(user.id) as { n: number };
    if (live.n > 0) throw fail('CONFLICT_STATE', 'Close your published or paused studies before deleting your account.');
    const active = db
      .prepare(`SELECT COUNT(*) AS n FROM participations WHERE tester_id = ? AND status IN ('submitted','disputed')`)
      .get(user.id) as { n: number };
    if (active.n > 0) throw fail('CONFLICT_STATE', 'Wait until your submitted work is reviewed and disputes are resolved.');

    const media: string[] = [];
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
      db.prepare(`UPDATE audit SET reason = '[redacted on account deletion]' WHERE target_type = 'user' AND target_id = ?`).run(user.id);
      db.prepare('DELETE FROM wallet_links WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM wallet_nonces WHERE user_id = ?').run(user.id);
      db.prepare(
        `UPDATE users SET email = ?, password_hash = NULL, display_name = 'Deleted user', device_json = NULL, status = 'deleted' WHERE id = ?`,
      ).run(`deleted-${user.id}@deleted.invalid`, user.id);
    })();
    for (const key of media) rmSync(join(ctx.deps.mediaDir, key), { force: true });
    return { ok: true as const };
  },

  aiStatus: () => ({ available: false, provider: null }),
} satisfies Record<string, Handler>;
