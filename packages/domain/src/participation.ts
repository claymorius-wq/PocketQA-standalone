import type { ParticipationStatus } from '@pocket-qa/contracts';
import { conflict, DomainError } from './errors';

export type ParticipationAction = 'start' | 'submit' | 'approve' | 'reject' | 'dispute' | 'resolve' | 'withdraw';

const TRANSITIONS: Record<ParticipationAction, Partial<Record<ParticipationStatus, ParticipationStatus>>> = {
  start: { consented: 'in_progress' },
  submit: { in_progress: 'submitted' },
  approve: { submitted: 'approved' },
  reject: { submitted: 'rejected' },
  dispute: { rejected: 'disputed' },
  resolve: { disputed: 'resolved' },
  withdraw: { consented: 'withdrawn', in_progress: 'withdrawn' },
};

export function transitionParticipation(from: ParticipationStatus, action: ParticipationAction): ParticipationStatus {
  const to = TRANSITIONS[action][from];
  if (!to) throw conflict(`Cannot ${action} a participation that is ${from.replace('_', ' ')}.`);
  return to;
}

/** Evidence and notes are frozen the moment a participation is submitted. */
export const canUploadEvidence = (s: ParticipationStatus) => s === 'in_progress';
export const canEditTaskNotes = (s: ParticipationStatus) => s === 'in_progress';

/** Statuses that always hold one reward's worth of the study budget. */
export const COMMITTING_STATUSES: ReadonlySet<ParticipationStatus> = new Set(['consented', 'in_progress', 'submitted', 'disputed']);
export const isCommitting = (s: ParticipationStatus) => COMMITTING_STATUSES.has(s);

/**
 * A rejected tester may dispute for this long after the decision. During the window the
 * rejection keeps its reward on hold and the study cannot close, so a builder can never
 * reject-then-close to strip the tester of recourse. After the window the hold releases.
 */
export const DISPUTE_WINDOW_MS = 7 * 24 * 3600 * 1000;

type Decided = { status: ParticipationStatus; decidedAtMs: number | null };
const inDisputeWindow = (p: Decided, nowMs: number) =>
  p.status === 'rejected' && p.decidedAtMs !== null && nowMs < p.decidedAtMs + DISPUTE_WINDOW_MS;

export const holdsBudget = (p: Decided, nowMs: number) => isCommitting(p.status) || inDisputeWindow(p, nowMs);
export const canOpenDispute = (p: Decided, nowMs: number) => inDisputeWindow(p, nowMs);

export const MIN_REJECTION_REASON = 10;

export function validateDecision(input: { decision: 'approve' | 'reject'; reviewerId: string; reason?: string }): {
  decision: 'approve' | 'reject';
  reviewerId: string;
  reason: string | null;
} {
  if (!input.reviewerId) throw new DomainError('VALIDATION', 'A decision needs a reviewer.');
  if (input.decision === 'approve') return { decision: 'approve', reviewerId: input.reviewerId, reason: null };
  const reason = (input.reason ?? '').trim();
  if (reason.length < MIN_REJECTION_REASON) {
    throw new DomainError('VALIDATION', `A rejection reason of at least ${MIN_REJECTION_REASON} characters is required.`);
  }
  return { decision: 'reject', reviewerId: input.reviewerId, reason };
}
