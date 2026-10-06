import { assertCleanCopy, LEADERBOARD_MIN_DECIDED, REPUTATION_WINDOW_DAYS } from '@pocket-qa/domain';
import { me, type Handler } from '../context';

export const reputationHandlers = {
  myReputation: (ctx) => ctx.deps.repo.escrow.reputationOf(me(ctx).id, ctx.deps.now()),

  /** Opt in with a pseudonym, or opt out (the alias is kept so it can be reused later). */
  putLeaderboard: async (ctx) => {
    const user = me(ctx);
    const { optIn, alias } = ctx.body as { optIn: boolean; alias?: string };
    if (alias !== undefined) assertCleanCopy({ alias });
    await ctx.deps.repo.escrow.putLeaderboard(user.id, optIn, alias, ctx.deps.now());
    return ctx.deps.repo.escrow.reputationOf(user.id, ctx.deps.now());
  },

  leaderboard: async (ctx) => ({ items: await ctx.deps.repo.escrow.leaderboard(ctx.deps.now()), windowDays: REPUTATION_WINDOW_DAYS, minDecided: LEADERBOARD_MIN_DECIDED }),

  /**
   * An admin upholds a fraud finding on accepted work: its points are reversed (append-only) and
   * it counts as rejected for reputation. Money is not touched here (outcome only).
   */
  adminFraud: async (ctx) => {
    const reason = (ctx.body as { reason: string }).reason;
    await ctx.deps.repo.escrow.upholdFraud(ctx.params.id!, reason, me(ctx).id, ctx.deps.now());
    return { ok: true as const };
  },
} satisfies Record<string, Handler>;
