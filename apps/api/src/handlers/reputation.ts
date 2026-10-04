import { assertCleanCopy } from '@pocket-qa/domain';
import { getParticipationRow } from '../access';
import { audit } from '../escrow';
import { me, type Handler } from '../context';
import { leaderboardRows, reputationView, reverseForFraud } from '../reputation';
import { fail, iso, notFound } from '../util';
import { LEADERBOARD_MIN_DECIDED, REPUTATION_WINDOW_DAYS } from '@pocket-qa/domain';

export const reputationHandlers = {
  myReputation: (ctx) => reputationView(ctx.deps.db, me(ctx).id, ctx.deps.now()),

  /** Opt in with a pseudonym, or opt out (the alias is kept so it can be reused later). */
  putLeaderboard: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const { optIn, alias } = ctx.body as { optIn: boolean; alias?: string };
    if (alias !== undefined) assertCleanCopy({ alias });
    db.transaction(() => {
      const cur = db.prepare('SELECT alias FROM leaderboard_profiles WHERE user_id = ?').get(user.id) as { alias: string | null } | undefined;
      const next = alias ?? cur?.alias ?? null;
      if (optIn && !next) throw fail('VALIDATION', 'Choose an alias to appear on the leaderboard.');
      if (next && db.prepare('SELECT 1 FROM leaderboard_profiles WHERE lower(alias) = lower(?) AND user_id != ?').get(next, user.id)) {
        throw fail('CONFLICT_STATE', 'That alias is taken.');
      }
      db.prepare(
        'INSERT INTO leaderboard_profiles (user_id, opted_in, alias, updated_at) VALUES (?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET opted_in = excluded.opted_in, alias = excluded.alias, updated_at = excluded.updated_at',
      ).run(user.id, optIn ? 1 : 0, next, iso(ctx.deps.now()));
    })();
    return reputationView(db, user.id, ctx.deps.now());
  },

  leaderboard: (ctx) => ({ items: leaderboardRows(ctx.deps.db, ctx.deps.now()), windowDays: REPUTATION_WINDOW_DAYS, minDecided: LEADERBOARD_MIN_DECIDED }),

  /**
   * An admin upholds a fraud finding on accepted work: its points are reversed (append-only) and
   * it counts as rejected for reputation. Money is not touched here (outcome only).
   */
  adminFraud: (ctx) => {
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const reason = (ctx.body as { reason: string }).reason;
    assertCleanCopy({ reason });
    db.transaction(() => {
      const p = getParticipationRow(db, ctx.params.id!);
      if (!p) throw notFound('Participation');
      const accepted = p.status === 'approved' || (p.status === 'resolved' && (db.prepare(`SELECT outcome FROM disputes WHERE participation_id = ?`).get(p.id) as { outcome: string } | undefined)?.outcome === 'overturned');
      if (!accepted) throw fail('CONFLICT_STATE', 'Only accepted work can be marked fraudulent.');
      if (db.prepare('SELECT 1 FROM fraud_findings WHERE participation_id = ?').get(p.id)) throw fail('CONFLICT_STATE', 'This work is already marked fraudulent.');
      db.prepare('INSERT INTO fraud_findings (participation_id, reason, decided_by, created_at) VALUES (?,?,?,?)').run(p.id, reason, me(ctx).id, iso(now));
      reverseForFraud(db, p, now);
      audit(db, me(ctx).id, 'reputation.fraud_upheld', 'participation', p.id, reason, now);
    })();
    return { ok: true as const };
  },
} satisfies Record<string, Handler>;
