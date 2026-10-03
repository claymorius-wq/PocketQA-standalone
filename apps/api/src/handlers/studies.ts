import type { DeviceProfile } from '@pocket-qa/contracts';
import {
  assertCleanCopy,
  checkEligibility,
  closeStudyPlan,
  planRelease,
  planReserve,
  requiredReserve,
  transitionStudy,
  userAccount,
  type StudyAction,
} from '@pocket-qa/domain';
import { getStudyRow, ownStudy } from '../access';
import { me, type Ctx, type Handler } from '../context';
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
      if (action === 'publish') {
        const amount = requiredReserve({ rewardCredits: s.reward_credits, slots: s.slots });
        post(db, planReserve({ builderId: user.id, studyId: s.id, amount, builderBalance: accountBalance(db, userAccount(user.id)) }), now);
        db.prepare('UPDATE studies SET status = ?, published_at = ? WHERE id = ?').run(next, iso(now), s.id);
      } else if (action === 'close') {
        const plan = closeStudyPlan({ studyBalance: studyBalance(db, s.id), nowMs: now, participations: participationStatuses(db, s.id) });
        for (const id of plan.withdraw) {
          db.prepare(`UPDATE participations SET status = 'withdrawn', decision_reason = 'Study closed by the builder.' WHERE id = ?`).run(id);
        }
        db.prepare('UPDATE studies SET status = ?, closed_at = ? WHERE id = ?').run(next, iso(now), s.id);
        post(db, planRelease({ studyId: s.id, builderId: user.id, studyBalance: plan.release }), now);
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
    const b = ctx.body;
    lintStudy(b);
    const id = newId();
    const db = ctx.deps.db;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO studies (id, builder_id, title, objective, build_under_test, device_criteria_json, reward_credits, slots, consent_text, consent_version, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,'draft',?)`,
      ).run(id, user.id, b.title, b.objective, b.buildUnderTest ?? null, JSON.stringify(b.deviceCriteria), b.rewardCredits, b.slots, b.consentText, iso(ctx.deps.now()));
      writeTasks(ctx, id, b.tasks);
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
    db.transaction(() => {
      const consentChanged = b.consentText !== undefined && b.consentText !== s.consent_text;
      db.prepare(
        `UPDATE studies SET title = ?, objective = ?, build_under_test = ?, device_criteria_json = ?, reward_credits = ?, slots = ?, consent_text = ?, consent_version = ? WHERE id = ?`,
      ).run(
        b.title ?? s.title,
        b.objective ?? s.objective,
        b.buildUnderTest !== undefined ? b.buildUnderTest : s.build_under_test,
        b.deviceCriteria !== undefined ? JSON.stringify(b.deviceCriteria) : s.device_criteria_json,
        b.rewardCredits ?? s.reward_credits,
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
      if (slotsFilled(db, s.id) >= s.slots || budgetOf(db, s, now).available < s.reward_credits) {
        throw fail('CONFLICT_STATE', 'This study is full.');
      }
      db.prepare(
        `INSERT INTO participations (id, study_id, tester_id, status, consent_version, consented_at, reward_credits) VALUES (?,?,?,'consented',?,?,?)`,
      ).run(id, s.id, user.id, s.consent_version, iso(now), s.reward_credits);
    })();
    const row = db.prepare('SELECT * FROM participations WHERE id = ?').get(id) as ParticipationRow;
    return participationView(db, row, { withTesterName: false });
  },
} satisfies Record<string, Handler>;
