import { describe, expect, it } from 'vitest';
import type { ParticipationStatus } from '@pocket-qa/contracts';
import { DomainError } from './errors';
import {
  canEditTaskNotes,
  canOpenDispute,
  canUploadEvidence,
  COMMITTING_STATUSES,
  DISPUTE_WINDOW_MS,
  holdsBudget,
  isCommitting,
  transitionParticipation,
  validateDecision,
  type ParticipationAction,
} from './participation';

const ALL: ParticipationStatus[] = ['consented', 'in_progress', 'submitted', 'approved', 'rejected', 'disputed', 'resolved', 'withdrawn'];
const ACTIONS: ParticipationAction[] = ['start', 'submit', 'approve', 'reject', 'dispute', 'resolve', 'withdraw'];

const ALLOWED: Record<string, ParticipationStatus> = {
  'consented:start': 'in_progress',
  'consented:withdraw': 'withdrawn',
  'in_progress:submit': 'submitted',
  'in_progress:withdraw': 'withdrawn',
  'submitted:approve': 'approved',
  'submitted:reject': 'rejected',
  'rejected:dispute': 'disputed',
  'disputed:resolve': 'resolved',
};

describe('participation state machine', () => {
  for (const from of ALL) {
    for (const action of ACTIONS) {
      const key = `${from}:${action}`;
      if (ALLOWED[key]) {
        it(`${key} → ${ALLOWED[key]}`, () => expect(transitionParticipation(from, action)).toBe(ALLOWED[key]));
      } else {
        it(`${key} is rejected`, () => {
          let err: unknown;
          try {
            transitionParticipation(from, action);
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(DomainError);
          expect((err as DomainError).code).toBe('CONFLICT_STATE');
        });
      }
    }
  }

  it('freezes evidence and notes once submitted', () => {
    for (const s of ALL) {
      expect(canUploadEvidence(s)).toBe(s === 'in_progress');
      expect(canEditTaskNotes(s)).toBe(s === 'in_progress');
    }
  });

  it('always commits a slot while consented, in progress, submitted or disputed', () => {
    expect([...COMMITTING_STATUSES].sort()).toEqual(['consented', 'disputed', 'in_progress', 'submitted']);
    expect(isCommitting('approved')).toBe(false);
    expect(isCommitting('withdrawn')).toBe(false);
    expect(isCommitting('resolved')).toBe(false);
    expect(isCommitting('rejected')).toBe(false);
    expect(isCommitting('submitted')).toBe(true);
  });

  it('a rejection holds its reward only while the dispute window is open', () => {
    const decided = 1_000_000;
    const rejected = { status: 'rejected' as const, decidedAtMs: decided };
    expect(holdsBudget(rejected, decided)).toBe(true);
    expect(holdsBudget(rejected, decided + DISPUTE_WINDOW_MS - 1)).toBe(true);
    expect(holdsBudget(rejected, decided + DISPUTE_WINDOW_MS)).toBe(false);
    expect(holdsBudget({ status: 'rejected', decidedAtMs: null }, decided)).toBe(false);
    expect(holdsBudget({ status: 'submitted', decidedAtMs: null }, decided)).toBe(true);
    expect(holdsBudget({ status: 'approved', decidedAtMs: decided }, decided)).toBe(false);
  });

  it('disputes can be opened only on a rejection inside its window', () => {
    const decided = 5_000;
    expect(canOpenDispute({ status: 'rejected', decidedAtMs: decided }, decided + 1)).toBe(true);
    expect(canOpenDispute({ status: 'rejected', decidedAtMs: decided }, decided + DISPUTE_WINDOW_MS)).toBe(false);
    expect(canOpenDispute({ status: 'approved', decidedAtMs: decided }, decided + 1)).toBe(false);
    expect(canOpenDispute({ status: 'rejected', decidedAtMs: null }, decided)).toBe(false);
  });
});

describe('validateDecision', () => {
  it('requires a reviewer for approval', () => {
    expect(() => validateDecision({ decision: 'approve', reviewerId: '' })).toThrowError(DomainError);
    expect(validateDecision({ decision: 'approve', reviewerId: 'u1' })).toEqual({ decision: 'approve', reviewerId: 'u1', reason: null });
  });

  it('requires a reviewer and a substantive reason for rejection', () => {
    expect(() => validateDecision({ decision: 'reject', reviewerId: 'u1', reason: '   ' })).toThrowError(/reason/);
    expect(() => validateDecision({ decision: 'reject', reviewerId: 'u1' })).toThrowError(/reason/);
    expect(() => validateDecision({ decision: 'reject', reviewerId: '', reason: 'Task 2 not attempted at all' })).toThrowError(DomainError);
    expect(validateDecision({ decision: 'reject', reviewerId: 'u1', reason: '  Task 2 not attempted at all ' })).toEqual({
      decision: 'reject',
      reviewerId: 'u1',
      reason: 'Task 2 not attempted at all',
    });
  });
});
