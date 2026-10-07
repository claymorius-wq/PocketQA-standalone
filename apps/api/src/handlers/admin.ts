import { assertCleanCopy, stuckReason } from '@pocket-qa/domain';
import { me, type Handler } from '../context';
import { fail, iso, notFound } from '../util';
import { auditView, disputeView, participationViewOf, studyViewOf } from '../views';

// Admin routes, through the repositories (docs/plans/firebase-vercel-refactor.md §2): the study,
// participation and dispute rules live in repo.studies (one transaction each, audited there);
// users and the audit trail in repo.core.
export const adminHandlers = {
  adminDisputes: async (ctx) => ({ items: (await ctx.deps.repo.studies.listAllDisputes()).map(disputeView) }),

  resolveDispute: async (ctx) => {
    const { outcome, note } = ctx.body;
    assertCleanCopy({ note });
    return disputeView(await ctx.deps.repo.studies.resolveDispute(ctx.params.id!, me(ctx), outcome, note, ctx.deps.now()));
  },

  adminStudies: async (ctx) => {
    const now = ctx.deps.now();
    const rows = await ctx.deps.repo.studies.listNonDraftStudies();
    return { items: await Promise.all(rows.map((r) => studyViewOf(ctx.deps.repo, r, now))) };
  },

  moderateStudy: async (ctx) => {
    const now = ctx.deps.now();
    const state = ctx.body.action === 'suspend' ? 'suspended' : 'ok';
    const s = await ctx.deps.repo.studies.moderateStudy(ctx.params.id!, state, { id: ctx.idemId('audit'), actorId: me(ctx).id, action: `study.${ctx.body.action}`, reason: ctx.body.reason, nowMs: now });
    return studyViewOf(ctx.deps.repo, s, now);
  },

  moderateUser: async (ctx) => {
    const core = ctx.deps.repo.core;
    const target = await core.userById(ctx.params.id!);
    if (!target || target.status === 'deleted') throw notFound('User');
    if (target.id === me(ctx).id) throw fail('CONFLICT_STATE', 'Admins cannot moderate themselves.');
    await core.setStatusAudited(target.id, ctx.body.action === 'suspend' ? 'suspended' : 'active', {
      // Deterministic under an Idempotency-Key, so a retried moderation can't add a second audit row.
      id: ctx.idemId('audit'),
      actor_id: me(ctx).id,
      action: `user.${ctx.body.action}`,
      target_type: 'user',
      target_id: target.id,
      reason: ctx.body.reason,
      created_at: iso(ctx.deps.now()),
    });
    return { ok: true as const };
  },

  adminStuck: async (ctx) => {
    const now = ctx.deps.now();
    const rows = await ctx.deps.repo.studies.listSubmittedWithStudy();
    const items = await Promise.all(
      rows.map(async (r) => {
        const reason = stuckReason({ status: r.status, submittedAtMs: r.submitted_at ? Date.parse(r.submitted_at) : null, builderStatus: r.builder_status }, now);
        if (!reason) return null;
        return {
          participation: await participationViewOf(ctx.deps.repo, r, { withTesterName: true }),
          studyId: r.study_id,
          studyTitle: r.study_title,
          builderStatus: r.builder_status,
          reason,
          tasks: await ctx.deps.repo.studies.tasksOf(r.study_id),
        };
      }),
    );
    return { items: items.filter((i) => i !== null) };
  },

  /**
   * Admin decision on a stuck submission only (builder inactive, or overdue). Same rules as a
   * builder decision: one credit at most, budget never negative, reason audited (repo.studies).
   */
  adminDecide: async (ctx) => {
    const { decision, reason } = ctx.body;
    assertCleanCopy({ reason });
    const p = await ctx.deps.repo.studies.decideParticipation(ctx.params.id!, { by: 'admin_stuck', actor: me(ctx), decision, reason }, ctx.deps.now());
    return participationViewOf(ctx.deps.repo, p, { withTesterName: true });
  },

  adminAudit: async (ctx) => ({ items: (await ctx.deps.repo.core.listAudit()).map(auditView) }),
} satisfies Record<string, Handler>;
