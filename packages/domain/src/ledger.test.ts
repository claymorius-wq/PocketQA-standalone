import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  balanceOf,
  FAUCET,
  planRelease,
  planReserve,
  planReward,
  planTopUp,
  studyAccount,
  studyBudget,
  userAccount,
  type Posting,
} from './ledger';

const builder = userAccount('b1');
const tester = userAccount('t1');
const study = studyAccount('s1');

function apply(ledger: Posting[], postings: Posting[]): Posting[] {
  return [...ledger, ...postings];
}

describe('ledger', () => {
  it('every plan is balanced (postings sum to zero)', () => {
    const plans = [
      planTopUp('b1', 500),
      planReserve({ builderId: 'b1', studyId: 's1', amount: 250, builderBalance: 500 }),
      planReward({ studyId: 's1', testerId: 't1', participationId: 'p1', amount: 50, studyAvailableIncludingThis: 250, kind: 'reward_credit' }),
      planRelease({ studyId: 's1', builderId: 'b1', studyBalance: 200 }),
    ];
    for (const p of plans) expect(p.reduce((sum, x) => sum + x.amount, 0)).toBe(0);
  });

  it('runs a full study lifecycle with derived balances', () => {
    let l: Posting[] = [];
    l = apply(l, planTopUp('b1', 500));
    expect(balanceOf(l, builder)).toBe(500);
    l = apply(l, planReserve({ builderId: 'b1', studyId: 's1', amount: 250, builderBalance: balanceOf(l, builder) }));
    expect(balanceOf(l, builder)).toBe(250);
    expect(balanceOf(l, study)).toBe(250);
    l = apply(l, planReward({ studyId: 's1', testerId: 't1', participationId: 'p1', amount: 50, studyAvailableIncludingThis: 250, kind: 'reward_credit' }));
    expect(balanceOf(l, tester)).toBe(50);
    expect(balanceOf(l, study)).toBe(200);
    l = apply(l, planRelease({ studyId: 's1', builderId: 'b1', studyBalance: balanceOf(l, study) }));
    expect(balanceOf(l, study)).toBe(0);
    expect(balanceOf(l, builder)).toBe(450);
    expect(balanceOf(l, FAUCET)).toBe(-500);
  });

  it('caps test top-ups and rejects non-integers', () => {
    expect(() => planTopUp('b1', 0)).toThrowError(DomainError);
    expect(() => planTopUp('b1', 10_001)).toThrowError(DomainError);
    expect(() => planTopUp('b1', 1.5)).toThrowError(DomainError);
  });

  it('refuses to reserve more than the builder balance', () => {
    let err: unknown;
    try {
      planReserve({ builderId: 'b1', studyId: 's1', amount: 251, builderBalance: 250 });
    } catch (e) {
      err = e;
    }
    expect((err as DomainError).code).toBe('BUDGET_INSUFFICIENT');
  });

  it('refuses a reward that would take the study budget negative', () => {
    expect(() =>
      planReward({ studyId: 's1', testerId: 't1', participationId: 'p1', amount: 50, studyAvailableIncludingThis: 49, kind: 'reward_credit' }),
    ).toThrowError(DomainError);
  });

  it('refuses a negative release', () => {
    expect(() => planRelease({ studyId: 's1', builderId: 'b1', studyBalance: -5 })).toThrowError(DomainError);
  });

  it('releases nothing when the study balance is already zero', () => {
    expect(planRelease({ studyId: 's1', builderId: 'b1', studyBalance: 0 })).toEqual([]);
  });
});

describe('studyBudget', () => {
  it('derives reserved, awarded, committed and available', () => {
    expect(studyBudget({ reserved: 250, awarded: 50, released: 0, rewardCredits: 50, committingCount: 2, closed: false })).toEqual({
      reserved: 250,
      awarded: 50,
      committed: 100,
      available: 100,
    });
  });

  it('commits nothing once closed', () => {
    expect(studyBudget({ reserved: 250, awarded: 50, released: 200, rewardCredits: 50, committingCount: 0, closed: true })).toEqual({
      reserved: 250,
      awarded: 50,
      committed: 0,
      available: 0,
    });
  });

  it('throws if the invariant is ever violated', () => {
    expect(() => studyBudget({ reserved: 100, awarded: 50, released: 0, rewardCredits: 50, committingCount: 2, closed: false })).toThrowError(
      /invariant/,
    );
  });
});
