import type { Participation } from '@pocket-qa/contracts';
import type { CommitStatus } from '../../ui/patterns';

// The review screen's view rules, kept pure so they can be tested without the router or the API.

export type DecisionKind = 'approve' | 'reject';

/** Findings can be written once the tester has submitted (unchanged rule). */
export function canAddFinding(status: Participation['status']): boolean {
  return status !== 'consented' && status !== 'in_progress' && status !== 'withdrawn';
}

/**
 * The Approve sheet's light (U7) from the decision request: pending holds the pilot, an error cuts
 * it, and `passing` (the request succeeded and the Commit pass plays in the open sheet) is success.
 */
export function commitStatus(m: { passing: boolean; isPending: boolean; isError: boolean }): CommitStatus {
  return m.passing ? 'success' : m.isPending ? 'pending' : m.isError ? 'error' : 'idle';
}

/**
 * Which of the two decision surfaces shows. While an approval's Commit pass plays in the open sheet
 * (`holding`: the server has already answered), the dock stays and the Decision notice waits, so the
 * two trade places when the sheet leaves and the tail lands on the notice (C4, board `decide()`).
 */
export function decisionView(p: Pick<Participation, 'status' | 'decidedAt'>, holding: boolean): { dock: boolean; notice: boolean } {
  return { dock: p.status === 'submitted' || holding, notice: p.status !== 'submitted' && !!p.decidedAt && !holding };
}
