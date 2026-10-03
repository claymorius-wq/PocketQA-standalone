import { STUCK_AFTER_DAYS, type ParticipationStatus } from '@pocket-qa/contracts';

const STUCK_AFTER_MS = STUCK_AFTER_DAYS * 24 * 3600 * 1000;

/**
 * Why a submission can no longer get a normal review, or null if it still can. Admins
 * may decide only stuck submissions; everything else stays the study owner's call.
 */
export function stuckReason(
  p: { status: ParticipationStatus; submittedAtMs: number | null; builderStatus: 'active' | 'suspended' | 'deleted' },
  nowMs: number,
): 'builder_inactive' | 'overdue' | null {
  if (p.status !== 'submitted') return null;
  if (p.builderStatus !== 'active') return 'builder_inactive';
  if (p.submittedAtMs !== null && nowMs - p.submittedAtMs >= STUCK_AFTER_MS) return 'overdue';
  return null;
}
