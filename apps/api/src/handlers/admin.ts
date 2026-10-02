import { assertCleanCopy, planReward, transitionParticipation } from '@pocket-qa/domain';
import { getParticipationRow, getStudyRow } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { post } from '../ledger';
import { fail, iso, newId, notFound } from '../util';
import { auditView, budgetOf, disputeView, studyView, type StudyRow } from '../views';

function audit(ctx: Ctx, action: string, targetType: 'study' | 'user' | 'dispute', targetId: string, reason: string) {
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
      if (outcome === 'overturned') {
        // The disputed participation still holds its reward, so add that hold back.
        const available = budgetOf(db, s, now).available + p.reward_credits;
        post(db, planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: available, kind: 'dispute_credit' }), now);
      }
      db.prepare('UPDATE participations SET status = ? WHERE id = ?').run(next, p.id);
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

  adminAudit: (ctx) => {
    const rows = ctx.deps.db.prepare('SELECT * FROM audit ORDER BY created_at DESC, rowid DESC').all() as Parameters<typeof auditView>[0][];
    return { items: rows.map(auditView) };
  },
} satisfies Record<string, Handler>;
