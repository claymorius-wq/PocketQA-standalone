import { assertCleanCopy, planReward, stuckReason, transitionParticipation } from '@pocket-qa/domain';
import { getParticipationRow, getStudyRow } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { post } from '../ledger';
import { fail, iso, newId, notFound } from '../util';
import { authorizePayout } from '../escrow';
import { awardApproval } from '../reputation';
import { auditView, budgetOf, disputeView, participationView, studyView, tasksOf, type ParticipationRow, type StudyRow } from '../views';

function audit(ctx: Ctx, action: string, targetType: 'study' | 'user' | 'dispute' | 'participation', targetId: string, reason: string) {
  ctx.deps.db
    .prepare('INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId(), me(ctx).id, action, targetType, targetId, reason, iso(ctx.deps.now()));
}

type DisputeRow = Parameters<typeof disputeView>[0];

export const adminHandlers = {
  adminDisputes: (ctx) => {
    const rows = ctx.deps.db.prepare(`SELECT * FROM disputes ORDER BY status = 'open' DESC, created_at DESC`).all() as DisputeRow[];
    return { items: rows.map(disputeView) };
  },

  resolveDispute: (ctx) => {
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const { outcome, note } = ctx.body;
    assertCleanCopy({ note });
    db.transaction(() => {
      const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(ctx.params.id!) as DisputeRow | undefined;
      if (!d) throw notFound('Dispute');
      if (d.status !== 'open') throw fail('CONFLICT_STATE', 'This dispute is already resolved.');
      const p = getParticipationRow(db, d.participation_id)!;
      const s = getStudyRow(db, p.study_id)!;
      const next = transitionParticipation(p.status, 'resolve');
      if (outcome === 'overturned' && s.payment_mode === 'escrow') {
        // The admin decides the outcome only; the amount and wallet were fixed earlier.
        authorizePayout(db, s, p, now, me(ctx).id, `dispute ${d.id} overturned`, 'arbiter');
      } else if (outcome === 'overturned') {
        // The disputed participation still holds its reward, so add that hold back.
        const available = budgetOf(db, s, now).available + p.reward_credits;
        post(db, planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: available, kind: 'dispute_credit' }), now);
      }
      db.prepare('UPDATE participations SET status = ? WHERE id = ?').run(next, p.id);
      if (outcome === 'overturned') awardApproval(db, s, p, false, now);
      db.prepare(`UPDATE disputes SET status = 'resolved', outcome = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).run(
        outcome,
        note,
        me(ctx).id,
        iso(now),
        d.id,
      );
      audit(ctx, `dispute.${outcome}`, 'dispute', d.id, note);
    })();
    return disputeView(db.prepare('SELECT * FROM disputes WHERE id = ?').get(ctx.params.id!) as DisputeRow);
  },

  adminStudies: (ctx) => {
    const db = ctx.deps.db;
    const rows = db.prepare(`SELECT * FROM studies WHERE status != 'draft' ORDER BY created_at DESC`).all() as StudyRow[];
    return { items: rows.map((r) => studyView(db, r, ctx.deps.now())) };
  },

  moderateStudy: (ctx) => {
    const db = ctx.deps.db;
    const s = getStudyRow(db, ctx.params.id!);
    if (!s) throw notFound('Study');
    const state = ctx.body.action === 'suspend' ? 'suspended' : 'ok';
    db.transaction(() => {
      db.prepare('UPDATE studies SET moderation = ? WHERE id = ?').run(state, s.id);
      audit(ctx, `study.${ctx.body.action}`, 'study', s.id, ctx.body.reason);
    })();
    return studyView(db, getStudyRow(db, s.id)!, ctx.deps.now());
  },

  moderateUser: (ctx) => {
    const db = ctx.deps.db;
    const target = db.prepare(`SELECT id, role FROM users WHERE id = ? AND status != 'deleted'`).get(ctx.params.id!) as { id: string; role: string } | undefined;
    if (!target) throw notFound('User');
    if (target.id === me(ctx).id) throw fail('CONFLICT_STATE', 'Admins cannot moderate themselves.');
    db.transaction(() => {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(ctx.body.action === 'suspend' ? 'suspended' : 'active', target.id);
      audit(ctx, `user.${ctx.body.action}`, 'user', target.id, ctx.body.reason);
    })();
    return { ok: true as const };
  },

  adminStuck: (ctx) => {
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const rows = db
      .prepare(
        `SELECT p.*, s.title AS study_title, u.status AS builder_status FROM participations p
         JOIN studies s ON s.id = p.study_id JOIN users u ON u.id = s.builder_id
         WHERE p.status = 'submitted' ORDER BY p.submitted_at`,
      )
      .all() as (ParticipationRow & { study_title: string; builder_status: 'active' | 'suspended' | 'deleted' })[];
    const items = rows.flatMap((r) => {
      const reason = stuckReason({ status: r.status, submittedAtMs: r.submitted_at ? Date.parse(r.submitted_at) : null, builderStatus: r.builder_status }, now);
      return reason
        ? [{ participation: participationView(db, r, { withTesterName: true }), studyId: r.study_id, studyTitle: r.study_title, builderStatus: r.builder_status, reason, tasks: tasksOf(db, r.study_id) }]
        : [];
    });
    return { items };
  },

  /**
   * Admin decision on a stuck submission only (builder inactive, or overdue). Same rules
   * as a builder decision: one credit at most, budget never negative, reason audited.
   */
  adminDecide: (ctx) => {
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const { decision, reason } = ctx.body;
    assertCleanCopy({ reason });
    db.transaction(() => {
      const p = getParticipationRow(db, ctx.params.id!);
      if (!p) throw notFound('Participation');
      const s = getStudyRow(db, p.study_id)!;
      const builder = db.prepare('SELECT status FROM users WHERE id = ?').get(s.builder_id) as { status: 'active' | 'suspended' | 'deleted' };
      const why = stuckReason({ status: p.status, submittedAtMs: p.submitted_at ? Date.parse(p.submitted_at) : null, builderStatus: builder.status }, now);
      if (!why) throw fail('CONFLICT_STATE', 'Only stuck submissions can be decided by an admin; the study owner reviews the rest.');
      const next = transitionParticipation(p.status, decision);
      if (decision === 'approve' && s.payment_mode === 'escrow') {
        authorizePayout(db, s, p, now, me(ctx).id, `admin decision on stuck work (${why})`, 'arbiter');
      } else if (decision === 'approve') {
        const available = budgetOf(db, s, now).available + p.reward_credits;
        post(db, planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: available, kind: 'reward_credit' }), now);
      }
      db.prepare('UPDATE participations SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?').run(next, iso(now), me(ctx).id, reason, p.id);
      if (decision === 'approve') awardApproval(db, s, p, false, now);
      audit(ctx, `participation.${decision}`, 'participation', p.id, `${reason} [stuck: ${why}]`);
    })();
    return participationView(db, getParticipationRow(db, ctx.params.id!)!, { withTesterName: true });
  },

  adminAudit: (ctx) => {
    const rows = ctx.deps.db.prepare('SELECT * FROM audit ORDER BY created_at DESC, rowid DESC').all() as Parameters<typeof auditView>[0][];
    return { items: rows.map(auditView) };
  },
} satisfies Record<string, Handler>;
