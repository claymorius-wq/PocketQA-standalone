import type { Dispute, Finding, Participation, Study, StudyReward, StudySummary } from '@pocket-qa/contracts';
import type { z } from 'zod';
import { holdsBudget, studyAccount, studyBudget, type Kind } from '@pocket-qa/domain';
import type { DB } from '../db';
import type { Repos } from '../repo';

import { budgetOf, paymentView, paymentViewOf, payoutView, payoutViewOf } from './escrow';
import { escrowOf, type SettlementRow } from '../escrow';

export type StudyRow = {
  id: string;
  builder_id: string;
  title: string;
  objective: string;
  build_under_test: string | null;
  device_criteria_json: string;
  /** Test credits, or token base units for escrow studies (see payment_mode). */
  reward_credits: number;
  payment_mode: 'test_credits' | 'escrow';
  slots: number;
  consent_text: string;
  consent_version: number;
  status: Study['status'];
  moderation: 'ok' | 'suspended';
  created_at: string;
  published_at: string | null;
  closed_at: string | null;
};

export type ParticipationRow = {
  id: string;
  study_id: string;
  tester_id: string;
  status: Participation['status'];
  consent_version: number;
  consented_at: string;
  started_at: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  reward_credits: number;
  payout_address: string | null;
};

export function tasksOf(db: DB, studyId: string) {
  return (
    db.prepare('SELECT id, ord, instruction, success_criteria FROM tasks WHERE study_id = ? ORDER BY ord').all(studyId) as {
      id: string;
      ord: number;
      instruction: string;
      success_criteria: string | null;
    }[]
  ).map((t) => ({
    id: t.id,
    order: t.ord,
    instruction: t.instruction,
    ...(t.success_criteria ? { successCriteria: t.success_criteria } : {}),
  }));
}

export function studyBalance(db: DB, studyId: string): number {
  const r = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE account = ?').get(studyAccount(studyId)) as { s: number };
  return r.s;
}

export function participationStatuses(db: DB, studyId: string): { id: string; status: Participation['status']; decidedAtMs: number | null }[] {
  const rows = db.prepare('SELECT id, status, decided_at FROM participations WHERE study_id = ?').all(studyId) as {
    id: string;
    status: Participation['status'];
    decided_at: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, status: r.status, decidedAtMs: r.decided_at ? Date.parse(r.decided_at) : null }));
}

export function slotsFilled(db: DB, studyId: string): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM participations WHERE study_id = ? AND status != 'withdrawn'`)
    .get(studyId) as { n: number };
  return r.n;
}

export function studyView(db: DB, row: StudyRow, nowMs: number): Study {
  return {
    id: row.id,
    builderId: row.builder_id,
    title: row.title,
    objective: row.objective,
    ...(row.build_under_test ? { buildUnderTest: row.build_under_test } : {}),
    tasks: tasksOf(db, row.id),
    deviceCriteria: JSON.parse(row.device_criteria_json),
    rewardCredits: row.payment_mode === 'escrow' ? 0 : row.reward_credits,
    payment: paymentView(db, row, nowMs),
    reward: rewardView(db, row),
    slots: row.slots,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
    status: row.status,
    moderation: row.moderation,
    budget: budgetOf(db, row, nowMs),
    slotsFilled: slotsFilled(db, row.id),
    createdAt: row.created_at,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
  };
}

export function studySummary(db: DB, row: StudyRow): StudySummary {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    rewardCredits: row.payment_mode === 'escrow' ? 0 : row.reward_credits,
    reward: rewardView(db, row),
    deviceCriteria: JSON.parse(row.device_criteria_json),
    status: row.status,
    publishedAt: row.published_at,
    taskCount: tasksOf(db, row.id).length,
    slotsRemaining: Math.max(0, row.slots - slotsFilled(db, row.id)),
  };
}

export function participationView(db: DB, row: ParticipationRow, opts: { withTesterName: boolean }): Participation {
  const notes = db
    .prepare('SELECT task_id, note FROM task_notes WHERE participation_id = ?')
    .all(row.id) as { task_id: string; note: string }[];
  let testerDisplayName: string | null = null;
  if (opts.withTesterName) {
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(row.tester_id) as { display_name: string } | undefined;
    testerDisplayName = u?.display_name ?? null;
  }
  const study = db.prepare('SELECT * FROM studies WHERE id = ?').get(row.study_id) as StudyRow;
  const payout = db.prepare(`SELECT * FROM settlements WHERE kind = 'payout' AND participation_id = ?`).get(row.id) as SettlementRow | undefined;
  return {
    id: row.id,
    studyId: row.study_id,
    testerId: row.tester_id,
    testerDisplayName,
    status: row.status,
    consentVersion: row.consent_version,
    consentedAt: row.consented_at,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    rewardCredits: study.payment_mode === 'escrow' ? 0 : row.reward_credits,
    reward: rewardView(db, study),
    payoutAddress: row.payout_address,
    payout: payout ? payoutView(db, payout) : null,
    taskNotes: notes.map((n) => ({ taskId: n.task_id, note: n.note })),
  };
}

export type FindingRow = {
  id: string;
  participation_id: string;
  title: string;
  severity: Finding['severity'];
  description: string;
  evidence_id: string | null;
  timestamp_ms: number | null;
  created_by: string;
  created_at: string;
};

export function findingView(row: FindingRow): Finding {
  return {
    id: row.id,
    participationId: row.participation_id,
    title: row.title,
    severity: row.severity,
    description: row.description,
    ...(row.evidence_id ? { evidenceId: row.evidence_id } : {}),
    ...(row.timestamp_ms !== null ? { timestampMs: row.timestamp_ms } : {}),
    createdBy: row.created_by,
    source: 'human',
    createdAt: row.created_at,
  };
}

export type DisputeRow = {
  id: string;
  participation_id: string;
  opened_by: string;
  reason: string;
  status: 'open' | 'resolved';
  outcome: 'upheld' | 'overturned' | null;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

export function disputeView(row: DisputeRow): z.infer<typeof Dispute> {
  return {
    id: row.id,
    participationId: row.participation_id,
    openedBy: row.opened_by,
    reason: row.reason,
    status: row.status,
    outcome: row.outcome,
    resolutionNote: row.resolution_note,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** What a tester is offered: test credits, or a (simulated-settlement) token reward. */
export function rewardView(db: DB, row: StudyRow): StudyReward {
  if (row.payment_mode !== 'escrow') return { kind: 'test_credits', credits: row.reward_credits };
  return { kind: 'token', asset: 'USDC', decimals: 6, units: row.reward_credits, settlement: escrowOf(db, row.id)?.settlement ?? 'simulated' };
}

// Async views over the repository (sqlite or firestore). The sync `(db, …)` views above stay until
// every caller has moved to these, then they are removed.

/** The test-credit budget of a study (ledger sums per kind plus the participations holding it). */
export async function studyBudgetOf(repo: Repos, row: StudyRow, nowMs: number) {
  // Escrow studies never use test credits; their books are in `payment.balances`.
  if (row.payment_mode === 'escrow') return { reserved: 0, awarded: 0, committed: 0, available: 0 };
  const [sums, statuses] = await Promise.all([repo.studies.studyKindSums(row.id), repo.studies.participationStatuses(row.id)]);
  const by = (k: Kind) => sums[k] ?? 0;
  return studyBudget({
    reserved: by('study_reserve'),
    awarded: -(by('reward_credit') + by('dispute_credit')),
    released: -by('study_release'),
    rewardCredits: row.reward_credits,
    committingCount: statuses.filter((p) => holdsBudget(p, nowMs)).length,
    closed: row.status === 'closed',
  });
}

/** What a tester is offered: test credits, or a (simulated-settlement) token reward. */
export async function rewardViewOf(repo: Repos, row: StudyRow): Promise<StudyReward> {
  if (row.payment_mode !== 'escrow') return { kind: 'test_credits', credits: row.reward_credits };
  return { kind: 'token', asset: 'USDC', decimals: 6, units: row.reward_credits, settlement: (await repo.escrow.escrowOf(row.id))?.settlement ?? 'simulated' };
}

export async function studyViewOf(repo: Repos, row: StudyRow, nowMs: number): Promise<Study> {
  const [tasks, payment, reward, budget, filled] = await Promise.all([
    repo.studies.tasksOf(row.id),
    paymentViewOf(repo, row, nowMs),
    rewardViewOf(repo, row),
    studyBudgetOf(repo, row, nowMs),
    repo.studies.slotsFilled(row.id),
  ]);
  return {
    id: row.id,
    builderId: row.builder_id,
    title: row.title,
    objective: row.objective,
    ...(row.build_under_test ? { buildUnderTest: row.build_under_test } : {}),
    tasks,
    deviceCriteria: JSON.parse(row.device_criteria_json),
    rewardCredits: row.payment_mode === 'escrow' ? 0 : row.reward_credits,
    payment,
    reward,
    slots: row.slots,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
    status: row.status,
    moderation: row.moderation,
    budget,
    slotsFilled: filled,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
  };
}

export async function studySummaryOf(repo: Repos, row: StudyRow): Promise<StudySummary> {
  const [reward, tasks, filled] = await Promise.all([rewardViewOf(repo, row), repo.studies.tasksOf(row.id), repo.studies.slotsFilled(row.id)]);
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    rewardCredits: row.payment_mode === 'escrow' ? 0 : row.reward_credits,
    reward,
    deviceCriteria: JSON.parse(row.device_criteria_json),
    status: row.status,
    publishedAt: row.published_at,
    taskCount: tasks.length,
    slotsRemaining: Math.max(0, row.slots - filled),
  };
}

export async function participationViewOf(repo: Repos, row: ParticipationRow, opts: { withTesterName: boolean }): Promise<Participation> {
  const [notes, tester, study, payout] = await Promise.all([
    repo.studies.taskNotes(row.id),
    opts.withTesterName ? repo.core.userById(row.tester_id) : Promise.resolve(null),
    repo.studies.getStudy(row.study_id),
    repo.escrow.payoutSettlementOf(row.id),
  ]);
  const s = study!;
  return {
    id: row.id,
    studyId: row.study_id,
    testerId: row.tester_id,
    testerDisplayName: tester?.display_name ?? null,
    status: row.status,
    consentVersion: row.consent_version,
    consentedAt: row.consented_at,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    rewardCredits: s.payment_mode === 'escrow' ? 0 : row.reward_credits,
    reward: await rewardViewOf(repo, s),
    payoutAddress: row.payout_address,
    payout: payout ? await payoutViewOf(repo, payout) : null,
    taskNotes: notes.map((n) => ({ taskId: n.task_id, note: n.note })),
  };
}
