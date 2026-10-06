import { ownerParticipationOf, partyParticipationOf } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { newId } from '../util';
import { disputeView, findingView, participationViewOf } from '../views';

function decide(decision: 'approve' | 'reject') {
  return async (ctx: Ctx) => {
    const repo = ctx.deps.repo;
    const row = await repo.studies.decideParticipation(
      ctx.params.id!,
      { by: 'builder', actor: me(ctx), decision, reason: ctx.body?.reason, note: ctx.body?.note, helpful: ctx.body?.helpful === true },
      ctx.deps.now(),
    );
    return participationViewOf(repo, row, { withTesterName: true });
  };
}

function testerTransition(action: 'start' | 'submit' | 'withdraw') {
  return async (ctx: Ctx) => {
    const repo = ctx.deps.repo;
    const row = await repo.studies.testerTransition(ctx.params.id!, me(ctx), action, ctx.body?.reason ?? null, ctx.deps.now());
    return participationViewOf(repo, row, { withTesterName: false });
  };
}

export const participationHandlers = {
  myParticipations: async (ctx) => {
    const repo = ctx.deps.repo;
    const rows = await repo.studies.listParticipationsByTester(me(ctx).id);
    return { items: await Promise.all(rows.map((p) => participationViewOf(repo, p, { withTesterName: false }))) };
  },

  getParticipation: async (ctx) => {
    const { p, as } = await partyParticipationOf(ctx.deps.repo, ctx.params.id!, me(ctx));
    return participationViewOf(ctx.deps.repo, p, { withTesterName: as !== 'tester' });
  },

  startParticipation: testerTransition('start'),
  submitParticipation: testerTransition('submit'),
  withdrawParticipation: testerTransition('withdraw'),

  putTaskNote: async (ctx) => {
    const repo = ctx.deps.repo;
    const row = await repo.studies.putTaskNote(ctx.params.id!, me(ctx), ctx.params.taskId!, ctx.body.note);
    return participationViewOf(repo, row, { withTesterName: false });
  },

  approve: decide('approve'),
  reject: decide('reject'),

  listFindings: async (ctx) => {
    const { p } = await partyParticipationOf(ctx.deps.repo, ctx.params.id!, me(ctx));
    return { items: (await ctx.deps.repo.studies.listFindings(p.id)).map(findingView) };
  },

  createFinding: async (ctx) => {
    const repo = ctx.deps.repo;
    const user = me(ctx);
    const { p } = await ownerParticipationOf(repo, ctx.params.id!, user);
    const b = ctx.body;
    const row = await repo.studies.createFinding(
      p.id,
      user,
      { title: b.title, severity: b.severity, description: b.description, evidenceId: b.evidenceId, timestampMs: b.timestampMs },
      newId(),
      ctx.deps.now(),
    );
    return findingView(row);
  },

  openDispute: async (ctx) => {
    const row = await ctx.deps.repo.studies.openDispute(ctx.body.participationId, me(ctx), ctx.body.reason, newId(), ctx.deps.now());
    return disputeView(row);
  },

  myDisputes: async (ctx) => ({ items: (await ctx.deps.repo.studies.listDisputesByOpener(me(ctx).id)).map(disputeView) }),
} satisfies Record<string, Handler>;
