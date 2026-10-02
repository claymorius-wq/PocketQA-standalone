import type { z } from 'zod';
import type { LedgerKind } from '@pocket-qa/contracts';
import { DomainError } from './errors';

/**
 * Double-entry, append-only test-credit ledger. Every plan returns postings that sum to
 * zero; balances are always derived by summing postings, never stored. Test credits are
 * minted only from the local FAUCET account and have no cash value.
 */
export type Account = `user:${string}` | `study:${string}` | 'system:test-faucet';
export type Kind = z.infer<typeof LedgerKind>;
export type Posting = {
  account: Account;
  amount: number;
  kind: Kind;
  studyId: string | null;
  participationId: string | null;
};

export const FAUCET: Account = 'system:test-faucet';
export const userAccount = (id: string): Account => `user:${id}`;
export const studyAccount = (id: string): Account => `study:${id}`;
export const MAX_TOPUP = 10_000;

export function balanceOf(postings: readonly Pick<Posting, 'account' | 'amount'>[], account: Account): number {
  let sum = 0;
  for (const p of postings) if (p.account === account) sum += p.amount;
  return sum;
}

function pair(from: Account, to: Account, amount: number, kind: Kind, studyId: string | null, participationId: string | null): Posting[] {
  return [
    { account: from, amount: -amount, kind, studyId, participationId },
    { account: to, amount, kind, studyId, participationId },
  ];
}

export function planTopUp(userId: string, amount: number): Posting[] {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_TOPUP) {
    throw new DomainError('VALIDATION', `Test credit top-ups must be whole numbers from 1 to ${MAX_TOPUP}.`);
  }
  return pair(FAUCET, userAccount(userId), amount, 'test_topup', null, null);
}

export function planReserve(input: { builderId: string; studyId: string; amount: number; builderBalance: number }): Posting[] {
  if (input.builderBalance < input.amount) {
    throw new DomainError(
      'BUDGET_INSUFFICIENT',
      `Publishing needs ${input.amount} test credits; you have ${input.builderBalance}.`,
    );
  }
  return pair(userAccount(input.builderId), studyAccount(input.studyId), input.amount, 'study_reserve', input.studyId, null);
}

/** `studyAvailableIncludingThis`: study balance minus holds of *other* participations. */
export function planReward(input: {
  studyId: string;
  testerId: string;
  participationId: string;
  amount: number;
  studyAvailableIncludingThis: number;
  kind: 'reward_credit' | 'dispute_credit';
}): Posting[] {
  if (input.studyAvailableIncludingThis < input.amount) {
    throw new DomainError('BUDGET_INSUFFICIENT', 'The study budget cannot cover this reward.');
  }
  return pair(studyAccount(input.studyId), userAccount(input.testerId), input.amount, input.kind, input.studyId, input.participationId);
}

export function planRelease(input: { studyId: string; builderId: string; studyBalance: number }): Posting[] {
  if (input.studyBalance < 0) throw new DomainError('INTERNAL', 'Ledger invariant violated: negative study balance.');
  if (input.studyBalance === 0) return [];
  return pair(studyAccount(input.studyId), userAccount(input.builderId), input.studyBalance, 'study_release', input.studyId, null);
}

export function studyBudget(input: {
  reserved: number;
  awarded: number;
  released: number;
  rewardCredits: number;
  committingCount: number;
  closed: boolean;
}): { reserved: number; awarded: number; committed: number; available: number } {
  const committed = input.closed ? 0 : input.rewardCredits * input.committingCount;
  const available = input.reserved - input.awarded - input.released - committed;
  if (available < 0) throw new DomainError('INTERNAL', 'Ledger invariant violated: study budget over-committed.');
  return { reserved: input.reserved, awarded: input.awarded, committed, available };
}
