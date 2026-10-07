import { assertCleanCopy, LEADERBOARD_MIN_DECIDED, REPUTATION_WINDOW_DAYS } from '@pocket-qa/domain';
import { me, type Handler } from '../context';
import { demoProfileFixtures, isDemoAlias, showcaseFrom } from '../devnet/demoShowcase';
import { fail, failWithStatus } from '../util';

export const reputationHandlers = {
  myReputation: (ctx) => ctx.deps.repo.escrow.reputationOf(me(ctx).id, ctx.deps.now()),

  /** Opt in with a pseudonym, or opt out (the alias is kept so it can be reused later). */
  putLeaderboard: async (ctx) => {
    const user = me(ctx);
    const { optIn, alias } = ctx.body as { optIn: boolean; alias?: string };
    if (alias !== undefined) assertCleanCopy({ alias });
    // pqa-qa B3 / P3-D2: "Demo…" names only the labelled demo examples (GET /demo/showcase), never a real tester.
    if (alias !== undefined && isDemoAlias(alias)) throw fail('VALIDATION', 'Aliases starting with "Demo" are reserved for the labelled demo examples.');
    await ctx.deps.repo.escrow.putLeaderboard(user.id, optIn, alias, ctx.deps.now());
    return ctx.deps.repo.escrow.reputationOf(user.id, ctx.deps.now());
  },

  leaderboard: async (ctx) => ({ items: await ctx.deps.repo.escrow.leaderboard(ctx.deps.now()), windowDays: REPUTATION_WINDOW_DAYS, minDecided: LEADERBOARD_MIN_DECIDED }),

  /**
   * The labelled demo examples (src/devnet/demoShowcase.ts), at most 10. Public, read-only. Per
   * config.demoShowcase: 'fixtures' (staging, the hosted app) serves the fixture itself and never
   * touches data; 'store' (devnet with POCKETQA_DEMO_SHOWCASE=1) reads the namespace's demoProfiles;
   * otherwise 404 FEATURE_UNAVAILABLE. Never merged into the leaderboard above.
   */
  demoShowcase: async (ctx) => {
    const { repo, config } = ctx.deps;
    if (config.demoShowcase === 'fixtures') return showcaseFrom(demoProfileFixtures());
    if (config.demoShowcase === 'store' && repo.namespace === 'devnet' && repo.escrow.demo) return showcaseFrom(await repo.escrow.demo.list());
    throw failWithStatus(404, 'FEATURE_UNAVAILABLE', 'The demo showcase is not available on this deployment.');
  },

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
