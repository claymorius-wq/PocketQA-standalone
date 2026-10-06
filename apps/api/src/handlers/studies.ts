import type { DeviceProfile } from '@pocket-qa/contracts';
import { assertCleanCopy, checkEligibility, quoteEscrow, type StudyAction } from '@pocket-qa/domain';
import { ownStudyOf } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { disputeView, participationViewOf, studySummaryOf, studyViewOf, type StudyRow } from '../views';
import { iso, newId, notFound, fail } from '../util';

type StudyBody = {
  title?: string;
  objective?: string;
  buildUnderTest?: string;
  tasks?: { instruction: string; successCriteria?: string }[];
  deviceCriteria?: unknown;
  rewardCredits?: number;
  rewardUnits?: number;
  payment?: { mode: 'test_credits' } | { mode: 'escrow'; rewardUnits: number };
  slots?: number;
  consentText?: string;
};

function lintStudy(b: StudyBody) {
  // Study content may describe prices, checkouts or devnet SOL in the app under test.
  assertCleanCopy({ title: b.title, objective: b.objective, buildUnderTest: b.buildUnderTest, consentText: b.consentText }, 'study');
  b.tasks?.forEach((t, i) => assertCleanCopy({ [`tasks[${i}].instruction`]: t.instruction, [`tasks[${i}].successCriteria`]: t.successCriteria }, 'study'));
}

function transition(action: StudyAction) {
  return async (ctx: Ctx) => {
    const repo = ctx.deps.repo;
    await repo.studies.studyTransition(ctx.params.id!, me(ctx), action, !!ctx.deps.settlement, ctx.deps.now());
    return studyViewOf(repo, (await repo.studies.getStudy(ctx.params.id!))!, ctx.deps.now());
  };
}

/** Testers may see a study that is open to them, or any study they already joined. */
async function testerVisibleStudy(ctx: Ctx): Promise<{ s: StudyRow; myParticipationId: string | null }> {
  const repo = ctx.deps.repo;
  const s = await repo.studies.getStudy(ctx.params.id!);
  if (!s) throw notFound('Study');
  const p = await repo.studies.findParticipation(s.id, me(ctx).id);
  if (!p && !(await repo.studies.openForNewWork(s))) throw notFound('Study');
  return { s, myParticipationId: p?.id ?? null };
}

export const studyHandlers = {
  listStudies: async (ctx) => {
    const repo = ctx.deps.repo;
    const rows = await repo.studies.listStudiesByBuilder(me(ctx).id);
    return { items: await Promise.all(rows.map((r) => studyViewOf(repo, r, ctx.deps.now()))) };
  },

  createStudy: async (ctx) => {
    const user = me(ctx);
    const b: StudyBody = ctx.body;
    lintStudy(b);
    const id = newId();
    const repo = ctx.deps.repo;
    const escrow = b.payment?.mode === 'escrow' ? b.payment : null;
    const settlement = ctx.deps.settlement;
    if (escrow && !settlement) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
    // Validates whole units and the total before anything is stored.
    if (escrow) quoteEscrow({ rewardUnits: escrow.rewardUnits, slots: b.slots!, feeBps: ctx.deps.config.escrowFeeBps });
    await repo.studies.createStudy({
      id,
      builderId: user.id,
      title: b.title!,
      objective: b.objective!,
      buildUnderTest: b.buildUnderTest ?? null,
      deviceCriteriaJson: JSON.stringify(b.deviceCriteria),
      rewardCredits: escrow ? escrow.rewardUnits : b.rewardCredits!,
      slots: b.slots!,
      consentText: b.consentText!,
      tasks: b.tasks!,
      createdAt: iso(ctx.deps.now()),
      escrow: escrow
        ? { settlement: settlement!.mode, network: settlement!.network, mint: settlement!.mint, vault: settlement!.vaultFor(id), feeBps: ctx.deps.config.escrowFeeBps }
        : null,
    });
    return studyViewOf(repo, (await repo.studies.getStudy(id))!, ctx.deps.now());
  },

  getStudy: async (ctx) => studyViewOf(ctx.deps.repo, await ownStudyOf(ctx.deps.repo, ctx.params.id!, me(ctx)), ctx.deps.now()),

  updateStudy: async (ctx) => {
    const repo = ctx.deps.repo;
    // Ownership and draft state first (404 before any copy error), re-checked in the write.
    const s = await ownStudyOf(repo, ctx.params.id!, me(ctx));
    if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Only draft studies can be edited.');
    const b: StudyBody = ctx.body;
    lintStudy(b);
    await repo.studies.updateDraftStudy(s.id, me(ctx), b);
    return studyViewOf(repo, (await repo.studies.getStudy(s.id))!, ctx.deps.now());
  },

  publishStudy: transition('publish'),
  pauseStudy: transition('pause'),
  resumeStudy: transition('resume'),
  closeStudy: transition('close'),

  studyParticipations: async (ctx) => {
    const repo = ctx.deps.repo;
    const s = await ownStudyOf(repo, ctx.params.id!, me(ctx));
    const rows = await repo.studies.listParticipationsByStudy(s.id);
    return { items: await Promise.all(rows.map((p) => participationViewOf(repo, p, { withTesterName: true }))) };
  },

  studyDisputes: async (ctx) => {
    const repo = ctx.deps.repo;
    const s = await ownStudyOf(repo, ctx.params.id!, me(ctx));
    return { items: (await repo.studies.listDisputesByStudy(s.id)).map(disputeView) };
  },

  eligibleStudies: async (ctx) => {
    const repo = ctx.deps.repo;
    const user = me(ctx);
    const device = user.device_json ? (JSON.parse(user.device_json) as DeviceProfile) : null;
    const rows = (await repo.studies.listOpenStudiesFor(user.id)).filter((s) => checkEligibility(JSON.parse(s.device_criteria_json), device).eligible);
    const items = (await Promise.all(rows.map((s) => studySummaryOf(repo, s)))).filter((s) => s.slotsRemaining > 0);
    return { items };
  },

  getTesterStudy: async (ctx) => {
    const repo = ctx.deps.repo;
    const { s, myParticipationId } = await testerVisibleStudy(ctx);
    return {
      ...(await studySummaryOf(repo, s)),
      buildUnderTest: s.build_under_test,
      tasks: await repo.studies.tasksOf(s.id),
      consentText: s.consent_text,
      consentVersion: s.consent_version,
      myParticipationId,
    };
  },

  consent: async (ctx) => {
    const repo = ctx.deps.repo;
    const row = await repo.studies.consent({
      studyId: ctx.params.id!,
      tester: me(ctx),
      consentVersion: ctx.body.consentVersion,
      payoutAddress: ctx.body.payoutAddress,
      settlementEnabled: !!ctx.deps.settlement,
      id: newId(),
      nowMs: ctx.deps.now(),
    });
    return participationViewOf(repo, row, { withTesterName: false });
  },
} satisfies Record<string, Handler>;
