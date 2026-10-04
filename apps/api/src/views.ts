import type {
  AuditEntry,
  DeviceProfile,
  Dispute,
  Evidence,
  EscrowFunding,
  Finding,
  Participation,
  Payout,
  Study,
  StudyPayment,
  StudyReward,
  StudySummary,
  User,
} from '@pocket-qa/contracts';
import type { z } from 'zod';
import { holdsBudget, studyAccount, studyBudget, type Kind } from '@pocket-qa/domain';
import type { DB } from './db';
import { iso } from './util';
import { escrowOf, studyEscrowBooks, studyQuote, type FundingRow, type SettlementRow } from './escrow';

export type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  role: 'tester' | 'builder' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  device_json: string | null;
  created_at: string;
};
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
export type EvidenceRow = {
  id: string;
  participation_id: string;
  kind: Evidence['kind'];
  mime_type: Evidence['mimeType'];
  size_bytes: number;
  duration_ms: number | null;
  task_id: string | null;
  captured_on: Evidence['capturedOn'];
  client_segment_id: string;
  storage_key: string;
  created_at: string;
};

export function userView(db: DB, row: UserRow): User {
  const link = db.prepare('SELECT address, linked_at FROM wallet_links WHERE user_id = ?').get(row.id) as
    | { address: string; linked_at: string }
    | undefined;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    device: row.device_json ? (JSON.parse(row.device_json) as DeviceProfile) : null,
    wallet: link ? { address: link.address, cluster: 'devnet', linkedAt: link.linked_at } : null,
    createdAt: row.created_at,
  };
}

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

export function budgetOf(db: DB, row: StudyRow, nowMs: number) {
  // Escrow studies never use test credits; their books are in `payment.balances`.
  if (row.payment_mode === 'escrow') return { reserved: 0, awarded: 0, committed: 0, available: 0 };
  const sums = db
    .prepare(
      `SELECT kind, COALESCE(SUM(amount),0) AS s FROM ledger WHERE account = ? GROUP BY kind`,
    )
    .all(studyAccount(row.id)) as { kind: Kind; s: number }[];
  const by = (k: Kind) => sums.find((x) => x.kind === k)?.s ?? 0;
  const committingCount = participationStatuses(db, row.id).filter((p) => holdsBudget(p, nowMs)).length;
  return studyBudget({
    reserved: by('study_reserve'),
    awarded: -(by('reward_credit') + by('dispute_credit')),
    released: -by('study_release'),
    rewardCredits: row.reward_credits,
    committingCount,
    closed: row.status === 'closed',
  });
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

export function evidenceView(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    participationId: row.participation_id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    taskId: row.task_id,
    capturedOn: row.captured_on,
    createdAt: row.created_at,
  };
}

type FindingRow = {
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

type DisputeRow = {
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

type AuditRow = { id: string; actor_id: string; action: string; target_type: 'study' | 'user' | 'dispute'; target_id: string; reason: string; created_at: string };
export function auditView(row: AuditRow): z.infer<typeof AuditEntry> {
  return { id: row.id, actorId: row.actor_id, action: row.action, targetType: row.target_type, targetId: row.target_id, reason: row.reason, createdAt: row.created_at };
}

/** What a tester is offered: test credits, or a (simulated-settlement) token reward. */
export function rewardView(db: DB, row: StudyRow): StudyReward {
  if (row.payment_mode !== 'escrow') return { kind: 'test_credits', credits: row.reward_credits };
  return { kind: 'token', asset: 'USDC', decimals: 6, units: row.reward_credits, settlement: 'simulated' };
}

/** Builder view of how a study is paid for; escrow books only for the owner (views are owner-scoped). */
export function paymentView(db: DB, row: StudyRow, nowMs: number): StudyPayment {
  if (row.payment_mode !== 'escrow') return { mode: 'test_credits' };
  const esc = escrowOf(db, row.id)!;
  const funded = db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(row.id) !== undefined;
  const { ok: _ok, ...balances } = studyEscrowBooks(db, row.id, nowMs);
  const refund = db.prepare(`SELECT status, amount_units FROM settlements WHERE kind = 'refund' AND study_id = ?`).get(row.id) as { status: SettlementRow['status']; amount_units: number } | undefined;
  return {
    mode: 'escrow',
    settlement: 'simulated',
    asset: 'USDC',
    decimals: 6,
    network: esc.network,
    mint: esc.mint,
    quote: studyQuote(row, esc),
    funded,
    balances,
    fundingWallet: esc.funding_wallet,
    refund: refund ? { status: refund.status, amountUnits: refund.amount_units } : null,
  };
}

export function payoutView(db: DB, s: SettlementRow): Payout {
  const title = (db.prepare('SELECT title FROM studies WHERE id = ?').get(s.study_id) as { title: string }).title;
  return {
    id: s.id,
    participationId: s.participation_id!,
    studyId: s.study_id,
    studyTitle: title,
    amountUnits: s.amount_units,
    asset: 'USDC',
    decimals: 6,
    destination: s.destination,
    settlement: 'simulated',
    status: s.status,
    signature: s.signature,
    failureReason: s.failure_reason,
    attempts: s.attempt,
    authorizedAt: iso(s.created_at),
    settledAt: s.settled_at ? iso(s.settled_at) : null,
  };
}

export function fundingView(db: DB, f: FundingRow): EscrowFunding {
  const esc = escrowOf(db, f.study_id)!;
  return {
    id: f.id,
    studyId: f.study_id,
    amountUnits: f.amount_units,
    asset: 'USDC',
    decimals: 6,
    network: esc.network,
    mint: esc.mint,
    vault: esc.vault,
    reference: f.reference,
    settlement: 'simulated',
    status: f.status,
    signature: f.signature,
    source: f.source,
    failureReason: f.failure_reason,
    createdAt: iso(f.created_at),
    expiresAt: iso(f.expires_at),
    confirmedAt: f.confirmed_at ? iso(f.confirmed_at) : null,
  };
}
