import type { DeviceProfile } from '@pocket-qa/contracts';
import {
  assertCleanCopy,
  checkEligibility,
  closeStudyPlan,
  planRelease,
  planReserve,
  quoteEscrow,
  requiredReserve,
  transitionStudy,
  userAccount,
  type StudyAction,
} from '@pocket-qa/domain';
import { getStudyRow, ownStudy } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { audit, authorizeRefund, canReserve, escrowOf, vaultBalance, studyQuote } from '../escrow';
import { accountBalance, post } from '../ledger';
import { fail, iso, newId, notFound } from '../util';
import {
  budgetOf,
  disputeView,
  participationStatuses,
  participationView,
  slotsFilled,
  studyBalance,
  studySummary,
  studyView,
  tasksOf,
  type ParticipationRow,
  type StudyRow,
} from '../views';

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

function writeTasks(ctx: Ctx, studyId: string, tasks: NonNullable<StudyBody['tasks']>) {
  const db = ctx.deps.db;
  db.prepare('DELETE FROM tasks WHERE study_id = ?').run(studyId);
  const ins = db.prepare('INSERT INTO tasks (id, study_id, ord, instruction, success_criteria) VALUES (?,?,?,?,?)');
  tasks.forEach((t, i) => ins.run(newId(), studyId, i, t.instruction, t.successCriteria ?? null));
}

function lifecycle(action: StudyAction) {
  return (ctx: Ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    db.transaction(() => {
      const s = ownStudy(db, ctx.params.id!, user);
      const next = transitionStudy(s.status, action);
      if ((action === 'publish' || action === 'resume') && s.moderation === 'suspended') {
        throw fail('CONFLICT_STATE', 'This study is suspended by moderation.');
      }
      const escrow = s.payment_mode === 'escrow';
      if (escrow && (action === 'publish' || action === 'resume') && !ctx.deps.settlement) {
        throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
      }
      if (action === 'publish' && escrow) {
        // Publish only on a confirmed funding that covers the whole quote (no holds exist yet).
        const funded = db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(s.id);
        if (!funded || vaultBalance(db, s.id) < studyQuote(s, escrowOf(db, s.id)!).totalUnits) {
          throw fail('BUDGET_INSUFFICIENT', 'Fund this study from your wallet, and wait for the funding to be confirmed, before publishing.');
        }
        db.prepare('UPDATE studies SET status = ?, published_at = ? WHERE id = ?').run(next, iso(now), s.id);
      } else if (action === 'publish') {
        const amount = requiredReserve({ rewardCredits: s.reward_credits, slots: s.slots });
        post(db, planReserve({ builderId: user.id, studyId: s.id, amount, builderBalance: accountBalance(db, userAccount(user.id)) }), now);
        db.prepare('UPDATE studies SET status = ?, published_at = ? WHERE id = ?').run(next, iso(now), s.id);
      } else if (action === 'close') {
        const plan = closeStudyPlan({ studyBalance: escrow ? vaultBalance(db, s.id) : studyBalance(db, s.id), nowMs: now, participations: participationStatuses(db, s.id) });
        for (const id of plan.withdraw) {
          db.prepare(`UPDATE participations SET status = 'withdrawn', decision_reason = 'Study closed by the builder.' WHERE id = ?`).run(id);
        }
        db.prepare('UPDATE studies SET status = ?, closed_at = ? WHERE id = ?').run(next, iso(now), s.id);
        // Escrow: unused funds go back to the funding wallet once the refund settles.
        if (escrow) authorizeRefund(db, { ...s, status: 'closed' }, now, user.id);
        else post(db, planRelease({ studyId: s.id, builderId: user.id, studyBalance: plan.release }), now);
      } else {
        db.prepare('UPDATE studies SET status = ? WHERE id = ?').run(next, s.id);
      }
    })();
    return studyView(db, getStudyRow(db, ctx.params.id!)!, ctx.deps.now());
  };
}

/** Testers may see a study that is open to them, or any study they already joined. */
/** Open to new testers: published, not moderated, and its builder's account is active. */
function openForNewWork(db: Ctx['deps']['db'], s: StudyRow): boolean {
  const b = db.prepare('SELECT status FROM users WHERE id = ?').get(s.builder_id) as { status: string } | undefined;
  return s.status === 'published' && s.moderation === 'ok' && b?.status === 'active';
}

function testerVisibleStudy(ctx: Ctx): { s: StudyRow; p: ParticipationRow | undefined } {
  const user = me(ctx);
  const s = getStudyRow(ctx.deps.db, ctx.params.id!);
  if (!s) throw notFound('Study');
  const p = ctx.deps.db.prepare('SELECT * FROM participations WHERE study_id = ? AND tester_id = ?').get(s.id, user.id) as
    | ParticipationRow
    | undefined;
  if (!p && !openForNewWork(ctx.deps.db, s)) throw notFound('Study');
  return { s, p };
}

export const studyHandlers = {
  listStudies: (ctx) => {
    const db = ctx.deps.db;
    const rows = db.prepare('SELECT * FROM studies WHERE builder_id = ? ORDER BY created_at DESC').all(me(ctx).id) as StudyRow[];
    return { items: rows.map((r) => studyView(db, r, ctx.deps.now())) };
  },

  createStudy: (ctx) => {
    const user = me(ctx);
    const b: StudyBody = ctx.body;
    lintStudy(b);
    const id = newId();
    const db = ctx.deps.db;
    const escrow = b.payment?.mode === 'escrow' ? b.payment : null;
    const settlement = ctx.deps.settlement;
    if (escrow && !settlement) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
    // Validates whole units and the total before anything is stored.
    if (escrow) quoteEscrow({ rewardUnits: escrow.rewardUnits, slots: b.slots!, feeBps: ctx.deps.config.escrowFeeBps });
    db.transaction(() => {
      db.prepare(
        `INSERT INTO studies (id, builder_id, title, objective, build_under_test, device_criteria_json, reward_credits, payment_mode, slots, consent_text, consent_version, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,'draft',?)`,
      ).run(id, user.id, b.title, b.objective, b.buildUnderTest ?? null, JSON.stringify(b.deviceCriteria), escrow ? escrow.rewardUnits : b.rewardCredits, escrow ? 'escrow' : 'test_credits', b.slots, b.consentText, iso(ctx.deps.now()));
      if (escrow) {
        db.prepare(`INSERT INTO study_escrows (study_id, settlement, network, mint, vault, fee_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          settlement!.mode,
          settlement!.network,
          settlement!.mint,
          settlement!.vaultFor(id),
          ctx.deps.config.escrowFeeBps,
          iso(ctx.deps.now()),
        );
      }
      writeTasks(ctx, id, b.tasks!);
    })();
    return studyView(db, getStudyRow(db, id)!, ctx.deps.now());
  },

  getStudy: (ctx) => studyView(ctx.deps.db, ownStudy(ctx.deps.db, ctx.params.id!, me(ctx)), ctx.deps.now()),

  updateStudy: (ctx) => {
    const db = ctx.deps.db;
    const s = ownStudy(db, ctx.params.id!, me(ctx));
    if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Only draft studies can be edited.');
    const b: StudyBody = ctx.body;
    lintStudy(b);
    const escrow = s.payment_mode === 'escrow';
    if (escrow && b.rewardCredits !== undefined) throw fail('VALIDATION', 'Escrow studies pay in tokens: change rewardUnits, not rewardCredits.');
    if (!escrow && b.rewardUnits !== undefined) throw fail('VALIDATION', 'Test-credit studies use rewardCredits.');
    if (escrow && (b.rewardUnits !== undefined || b.slots !== undefined)) {
      // The funded amount was fixed by the quote: the terms lock once funding has started.
      if (db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status IN ('awaiting_payment','pending','confirmed')`).get(s.id)) {
        throw fail('CONFLICT_STATE', 'The reward and slots are locked once funding has started.');
      }
      quoteEscrow({ rewardUnits: b.rewardUnits ?? s.reward_credits, slots: b.slots ?? s.slots, feeBps: escrowOf(db, s.id)!.fee_bps });
    }
    db.transaction(() => {
      const consentChanged = b.consentText !== undefined && b.consentText !== s.consent_text;
      db.prepare(
        `UPDATE studies SET title = ?, objective = ?, build_under_test = ?, device_criteria_json = ?, reward_credits = ?, slots = ?, consent_text = ?, consent_version = ? WHERE id = ?`,
      ).run(
        b.title ?? s.title,
        b.objective ?? s.objective,
        b.buildUnderTest !== undefined ? b.buildUnderTest : s.build_under_test,
        b.deviceCriteria !== undefined ? JSON.stringify(b.deviceCriteria) : s.device_criteria_json,
        (escrow ? b.rewardUnits : b.rewardCredits) ?? s.reward_credits,
        b.slots ?? s.slots,
        b.consentText ?? s.consent_text,
        consentChanged ? s.consent_version + 1 : s.consent_version,
        s.id,
      );
      if (b.tasks) writeTasks(ctx, s.id, b.tasks);
    })();
    return studyView(db, getStudyRow(db, s.id)!, ctx.deps.now());
  },

  publishStudy: lifecycle('publish'),
  pauseStudy: lifecycle('pause'),
  resumeStudy: lifecycle('resume'),
  closeStudy: lifecycle('close'),

  studyParticipations: (ctx) => {
    const db = ctx.deps.db;
    const s = ownStudy(db, ctx.params.id!, me(ctx));
    const rows = db.prepare('SELECT * FROM participations WHERE study_id = ? ORDER BY consented_at').all(s.id) as ParticipationRow[];
    return { items: rows.map((p) => participationView(db, p, { withTesterName: true })) };
  },

  studyDisputes: (ctx) => {
    const db = ctx.deps.db;
    const s = ownStudy(db, ctx.params.id!, me(ctx));
    const rows = db
      .prepare(`SELECT d.* FROM disputes d JOIN participations p ON p.id = d.participation_id WHERE p.study_id = ? ORDER BY d.created_at DESC`)
      .all(s.id) as Parameters<typeof disputeView>[0][];
    return { items: rows.map(disputeView) };
  },

  eligibleStudies: (ctx) => {
    const db = ctx.deps.db;
    const user = me(ctx);
    const device = user.device_json ? (JSON.parse(user.device_json) as DeviceProfile) : null;
    const rows = db
      .prepare(
        `SELECT s.* FROM studies s JOIN users b ON b.id = s.builder_id
         WHERE s.status = 'published' AND s.moderation = 'ok' AND b.status = 'active'
         AND s.id NOT IN (SELECT study_id FROM participations WHERE tester_id = ?) ORDER BY s.published_at DESC`,
      )
      .all(user.id) as StudyRow[];
    const items = rows
      .filter((s) => checkEligibility(JSON.parse(s.device_criteria_json), device).eligible)
      .map((s) => studySummary(db, s))
      .filter((s) => s.slotsRemaining > 0);
    return { items };
  },

  getTesterStudy: (ctx) => {
    const { s, p } = testerVisibleStudy(ctx);
    return {
      ...studySummary(ctx.deps.db, s),
      buildUnderTest: s.build_under_test,
      tasks: tasksOf(ctx.deps.db, s.id),
      consentText: s.consent_text,
      consentVersion: s.consent_version,
      myParticipationId: p?.id ?? null,
    };
  },

  consent: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const id = newId();
    db.transaction(() => {
      const s = getStudyRow(db, ctx.params.id!);
      if (!s || !openForNewWork(db, s)) throw notFound('Study');
      if (db.prepare('SELECT 1 FROM participations WHERE study_id = ? AND tester_id = ?').get(s.id, user.id)) {
        throw fail('CONFLICT_STATE', 'You already joined this study.');
      }
      if (ctx.body.consentVersion !== s.consent_version) {
        throw fail('CONFLICT_STATE', 'The consent text changed. Read the latest version and consent again.');
      }
      const device = user.device_json ? (JSON.parse(user.device_json) as DeviceProfile) : null;
      const elig = checkEligibility(JSON.parse(s.device_criteria_json), device);
      if (!elig.eligible) throw fail('CONFLICT_STATE', `Not eligible: ${elig.reasons.join(' ')}`);
      let payoutAddress: string | null = null;
      if (s.payment_mode === 'escrow') {
        if (!ctx.deps.settlement) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
        // The payout wallet is frozen here, with the tester's explicit confirmation of it.
        const linked = (db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(user.id) as { address: string } | undefined)?.address;
        if (!linked) throw fail('CONFLICT_STATE', 'Link the wallet you want rewards sent to before joining a wallet-funded study.');
        if (ctx.body.payoutAddress !== linked) throw fail('VALIDATION', 'Confirm your linked wallet as the payout wallet for this study.');
        // Self-dealing: a wallet that funded any of this builder's studies can't be paid by them.
        const funder = db
          .prepare(`SELECT 1 FROM study_escrows e JOIN studies x ON x.id = e.study_id WHERE x.builder_id = ? AND e.funding_wallet = ?`)
          .get(s.builder_id, linked);
        if (funder) throw fail('CONFLICT_STATE', 'This wallet funded a study by the same builder, so it can’t receive this study’s rewards.');
        payoutAddress = linked;
        if (slotsFilled(db, s.id) >= s.slots || !canReserve(db, s, now)) throw fail('CONFLICT_STATE', 'This study is full.');
      } else if (slotsFilled(db, s.id) >= s.slots || budgetOf(db, s, now).available < s.reward_credits) {
        throw fail('CONFLICT_STATE', 'This study is full.');
      }
      db.prepare(
        `INSERT INTO participations (id, study_id, tester_id, status, consent_version, consented_at, reward_credits, payout_address) VALUES (?,?,?,'consented',?,?,?,?)`,
      ).run(id, s.id, user.id, s.consent_version, iso(now), s.reward_credits, payoutAddress);
      if (payoutAddress) audit(db, user.id, 'escrow.payout_wallet_frozen', 'participation', id, `Payout wallet ${payoutAddress} confirmed at consent`, now);
    })();
    const row = db.prepare('SELECT * FROM participations WHERE id = ?').get(id) as ParticipationRow;
    return participationView(db, row, { withTesterName: false });
  },
} satisfies Record<string, Handler>;
