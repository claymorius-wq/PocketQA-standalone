import type { ParticipationStatus, StudyStatus } from '@pocket-qa/contracts';
import { conflict, DomainError } from './errors';
import { canOpenDispute } from './participation';

export type StudyAction = 'publish' | 'pause' | 'resume' | 'close';

const TRANSITIONS: Record<StudyAction, Partial<Record<StudyStatus, StudyStatus>>> = {
  publish: { draft: 'published' },
  pause: { published: 'paused' },
  resume: { paused: 'published' },
  close: { draft: 'closed', published: 'closed', paused: 'closed' },
};

export function transitionStudy(from: StudyStatus, action: StudyAction): StudyStatus {
  const to = TRANSITIONS[action][from];
  if (!to) throw conflict(`Cannot ${action} a ${from} study.`);
  return to;
}

export function requiredReserve(study: { rewardCredits: number; slots: number }): number {
  return study.rewardCredits * study.slots;
}

/**
 * Closing: in-flight testers (consented / in progress) are withdrawn by the system, but
 * submissions awaiting review, open disputes and rejections still inside their dispute
 * window must settle first, so a close can never strand credits a tester may be owed.
 * After close the whole study balance returns to the builder.
 */
export function closeStudyPlan(input: {
  studyBalance: number;
  nowMs: number;
  participations: { id: string; status: ParticipationStatus; decidedAtMs: number | null }[];
}): { withdraw: string[]; release: number } {
  if (input.participations.some((p) => p.status === 'submitted')) {
    throw conflict('Review every submitted participation before closing the study.');
  }
  if (input.participations.some((p) => p.status === 'disputed')) {
    throw conflict('Resolve open disputes before closing the study.');
  }
  if (input.participations.some((p) => canOpenDispute(p, input.nowMs))) {
    throw conflict('A rejected tester can still dispute (7-day dispute window). Close the study after the window ends.');
  }
  if (input.studyBalance < 0) throw new DomainError('INTERNAL', 'Ledger invariant violated: negative study balance.');
  return {
    withdraw: input.participations.filter((p) => p.status === 'consented' || p.status === 'in_progress').map((p) => p.id),
    release: input.studyBalance,
  };
}
