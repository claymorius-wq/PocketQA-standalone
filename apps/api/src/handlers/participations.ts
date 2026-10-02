import { assertCleanCopy, canEditTaskNotes, canOpenDispute, planReward, transitionParticipation, validateDecision } from '@pocket-qa/domain';
import { getParticipationRow, ownerParticipation, partyParticipation, testerParticipation } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { post } from '../ledger';
import { fail, iso, newId } from '../util';
import { budgetOf, disputeView, findingView, participationView, tasksOf, type ParticipationRow } from '../views';

function view(ctx: Ctx, id: string, withTesterName: boolean) {
  return participationView(ctx.deps.db, getParticipationRow(ctx.deps.db, id)!, { withTesterName });
}

function decide(decision: 'approve' | 'reject') {
  return (ctx: Ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    db.transaction(() => {
      const { p, s } = ownerParticipation(db, ctx.params.id!, user);
      const d = validateDecision({ decision, reviewerId: user.id, reason: ctx.body?.reason });
      assertCleanCopy({ reason: d.reason ?? undefined, note: ctx.body?.note });
      const next = transitionParticipation(p.status, decision);
      if (decision === 'approve') {
        // This participation is still counted as committed, so add its own hold back.
        const available = budgetOf(db, s, now).available + p.reward_credits;
        post(
          db,
          planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: available, kind: 'reward_credit' }),
          now,
        );
      }
      db.prepare('UPDATE participations SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?').run(
        next,
        iso(now),
        user.id,
        d.reason ?? ctx.body?.note ?? null,
        p.id,
      );
    })();
    return view(ctx, ctx.params.id!, true);
  };
}

function testerTransition(action: 'start' | 'submit' | 'withdraw') {
  return (ctx: Ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    db.transaction(() => {
      const { p, s } = testerParticipation(db, ctx.params.id!, user);
      if (action === 'start' && (s.status !== 'published' || s.moderation !== 'ok')) {
        throw fail('CONFLICT_STATE', 'This study is not accepting work right now.');
      }
      const next = transitionParticipation(p.status, action);
      const col = action === 'start' ? 'started_at' : action === 'submit' ? 'submitted_at' : null;
      if (col) db.prepare(`UPDATE participations SET status = ?, ${col} = ? WHERE id = ?`).run(next, iso(now), p.id);
      else db.prepare('UPDATE participations SET status = ?, decision_reason = ? WHERE id = ?').run(next, ctx.body?.reason ?? null, p.id);
    })();
    return view(ctx, ctx.params.id!, false);
  };
}

export const participationHandlers = {
  myParticipations: (ctx) => {
    const db = ctx.deps.db;
    const rows = db.prepare('SELECT * FROM participations WHERE tester_id = ? ORDER BY consented_at DESC').all(me(ctx).id) as ParticipationRow[];
    return { items: rows.map((p) => participationView(db, p, { withTesterName: false })) };
  },

  getParticipation: (ctx) => {
    const { p, as } = partyParticipation(ctx.deps.db, ctx.params.id!, me(ctx));
    return participationView(ctx.deps.db, p, { withTesterName: as !== 'tester' });
  },

  startParticipation: testerTransition('start'),
  submitParticipation: testerTransition('submit'),
  withdrawParticipation: testerTransition('withdraw'),

  putTaskNote: (ctx) => {
    const db = ctx.deps.db;
    const { p, s } = testerParticipation(db, ctx.params.id!, me(ctx));
    if (!canEditTaskNotes(p.status)) throw fail('CONFLICT_STATE', 'Notes can only change while the participation is in progress.');
    if (!tasksOf(db, s.id).some((t) => t.id === ctx.params.taskId)) throw fail('VALIDATION', 'Unknown task for this study.');
    db.prepare(
      'INSERT INTO task_notes (participation_id, task_id, note) VALUES (?,?,?) ON CONFLICT (participation_id, task_id) DO UPDATE SET note = excluded.note',
    ).run(p.id, ctx.params.taskId, ctx.body.note);
    return view(ctx, p.id, false);
  },

  approve: decide('approve'),
  reject: decide('reject'),

  listFindings: (ctx) => {
    const { p } = partyParticipation(ctx.deps.db, ctx.params.id!, me(ctx));
    const rows = ctx.deps.db.prepare('SELECT * FROM findings WHERE participation_id = ? ORDER BY created_at').all(p.id) as Parameters<typeof findingView>[0][];
    return { items: rows.map(findingView) };
  },

  createFinding: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const { p } = ownerParticipation(db, ctx.params.id!, user);
    if (p.status === 'consented' || p.status === 'in_progress' || p.status === 'withdrawn') {
      throw fail('CONFLICT_STATE', 'Findings can be added once the tester has submitted.');
    }
    const b = ctx.body;
    assertCleanCopy({ title: b.title, description: b.description });
    if (b.evidenceId && !db.prepare('SELECT 1 FROM evidence WHERE id = ? AND participation_id = ?').get(b.evidenceId, p.id)) {
      throw fail('VALIDATION', 'evidenceId does not belong to this participation.');
    }
    const id = newId();
    db.prepare(
      'INSERT INTO findings (id, participation_id, title, severity, description, evidence_id, timestamp_ms, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(id, p.id, b.title, b.severity, b.description, b.evidenceId ?? null, b.timestampMs ?? null, user.id, iso(ctx.deps.now()));
    return findingView(db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Parameters<typeof findingView>[0]);
  },

  openDispute: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const id = newId();
    db.transaction(() => {
      const { p } = testerParticipation(db, ctx.body.participationId, user);
      const next = transitionParticipation(p.status, 'dispute');
      if (!canOpenDispute({ status: p.status, decidedAtMs: p.decided_at ? Date.parse(p.decided_at) : null }, ctx.deps.now())) {
        throw fail('CONFLICT_STATE', 'The 7-day dispute window for this decision has ended.');
      }
      db.prepare('UPDATE participations SET status = ? WHERE id = ?').run(next, p.id);
      db.prepare(`INSERT INTO disputes (id, participation_id, opened_by, reason, status, created_at) VALUES (?,?,?,?,'open',?)`).run(
        id,
        p.id,
        user.id,
        ctx.body.reason,
        iso(ctx.deps.now()),
      );
    })();
    return disputeView(db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Parameters<typeof disputeView>[0]);
  },

  myDisputes: (ctx) => {
    const rows = ctx.deps.db.prepare('SELECT * FROM disputes WHERE opened_by = ? ORDER BY created_at DESC').all(me(ctx).id) as Parameters<typeof disputeView>[0][];
    return { items: rows.map(disputeView) };
  },
} satisfies Record<string, Handler>;
