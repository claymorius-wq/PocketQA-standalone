import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { closeStudyPlan, requiredReserve, transitionStudy, type StudyAction } from './study';
import { DISPUTE_WINDOW_MS } from './participation';
import type { StudyStatus } from '@pocket-qa/contracts';

const ALL: StudyStatus[] = ['draft', 'published', 'paused', 'closed'];
const ACTIONS: StudyAction[] = ['publish', 'pause', 'resume', 'close'];

const ALLOWED: Record<string, StudyStatus> = {
  'draft:publish': 'published',
  'published:pause': 'paused',
  'paused:resume': 'published',
  'published:close': 'closed',
  'paused:close': 'closed',
  'draft:close': 'closed',
};

describe('study state machine', () => {
  for (const from of ALL) {
    for (const action of ACTIONS) {
      const key = `${from}:${action}`;
      if (ALLOWED[key]) {
        it(`${key} → ${ALLOWED[key]}`, () => expect(transitionStudy(from, action)).toBe(ALLOWED[key]));
      } else {
        it(`${key} is rejected with CONFLICT_STATE`, () => {
          expect(() => transitionStudy(from, action)).toThrowError(DomainError);
          try {
            transitionStudy(from, action);
          } catch (e) {
            expect((e as DomainError).code).toBe('CONFLICT_STATE');
          }
        });
      }
    }
  }

  it('requires reward × slots to be reserved', () => {
    expect(requiredReserve({ rewardCredits: 50, slots: 5 })).toBe(250);
  });
});

describe('closeStudyPlan', () => {
  it('auto-withdraws in-flight participations and releases the whole study balance', () => {
    const plan = closeStudyPlan({
      studyBalance: 300,
      nowMs: DISPUTE_WINDOW_MS + 10,
      participations: [
        { id: 'a', status: 'consented', decidedAtMs: null },
        { id: 'b', status: 'in_progress', decidedAtMs: null },
        { id: 'c', status: 'approved', decidedAtMs: 1 },
        { id: 'd', status: 'rejected', decidedAtMs: 5 },
        { id: 'e', status: 'withdrawn', decidedAtMs: null },
      ],
    });
    expect(plan).toEqual({ withdraw: ['a', 'b'], release: 300 });
  });

  it('refuses to close while submissions await review or disputes are open', () => {
    expect(() => closeStudyPlan({ studyBalance: 10, nowMs: 0, participations: [{ id: 'x', status: 'submitted', decidedAtMs: null }] })).toThrowError(/review/i);
    expect(() => closeStudyPlan({ studyBalance: 10, nowMs: 0, participations: [{ id: 'y', status: 'disputed', decidedAtMs: null }] })).toThrowError(/dispute/i);
  });

  it('refuses to close while a rejection is still inside its dispute window', () => {
    const rejected = [{ id: 'r', status: 'rejected' as const, decidedAtMs: 1000 }];
    expect(() => closeStudyPlan({ studyBalance: 10, nowMs: 1000 + DISPUTE_WINDOW_MS - 1, participations: rejected })).toThrowError(/dispute window/i);
    expect(closeStudyPlan({ studyBalance: 10, nowMs: 1000 + DISPUTE_WINDOW_MS, participations: rejected })).toEqual({ withdraw: [], release: 10 });
  });

  it('never releases a negative amount', () => {
    expect(() => closeStudyPlan({ studyBalance: -1, nowMs: 0, participations: [] })).toThrowError(DomainError);
  });
});
