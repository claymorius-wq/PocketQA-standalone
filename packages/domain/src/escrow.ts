import { conflict, DomainError } from './errors';

/**
 * Wallet-funded study escrow (docs/plans/wallet-escrow-rewards-leaderboard.md, workstream B).
 *
 * Money is always a whole number of token base units (USDC has 6 decimals: 1 USDC =
 * 1_000_000 units). Amounts are JavaScript numbers that are checked to be safe integers at
 * every boundary, and capped far below 2^53, so arithmetic is exact; no floating point is
 * ever used for money. This ledger is separate from test credits and from reputation points.
 *
 * Accounts (double-entry; every plan sums to zero; balances are derived, never stored):
 * - `in:funding`             where verified funding transfers come from (outside the system)
 * - `vault:<study>`          the study's escrowed, unallocated funds
 * - `payable:<participation>` an approved reward awaiting a confirmed payout
 * - `fees:platform`          the disclosed platform fee, earned per approved test
 * - `out:tester:<user>`      confirmed payouts (left the system)
 * - `out:refund:<builder>`   refunds of unused funds after the study closes
 */
export const USDC_DECIMALS = 6;
/** Per-study cap (1,000,000 USDC): keeps every product and sum far inside safe integers. */
export const MAX_ESCROW_UNITS = 1_000_000_000_000;
export const MAX_FEE_BPS = 10_000;

export type EscrowKind = 'funding' | 'payout_authorized' | 'fee_earned' | 'payout_settled' | 'refund';
export type EscrowPosting = { account: string; amount: number; kind: EscrowKind; studyId: string | null; participationId: string | null };

export type EscrowQuote = {
  rewardUnits: number;
  slots: number;
  feeBps: number;
  perTestFeeUnits: number;
  perTestTotalUnits: number;
  rewardPoolUnits: number;
  platformFeeUnits: number;
  totalUnits: number;
};

function units(n: number, what: string, opts: { positive?: boolean } = {}): number {
  if (!Number.isSafeInteger(n) || n < 0 || (opts.positive && n === 0) || n > MAX_ESCROW_UNITS) {
    throw new DomainError('VALIDATION', `${what} must be a whole number of token units${opts.positive ? ' above zero' : ''}, at most ${MAX_ESCROW_UNITS}.`);
  }
  return n;
}

/**
 * The amount a builder funds. The platform fee is charged per approved test, as a rounded-up
 * whole unit of the reward (`ceil(reward × bps / 10000)`), and the unearned fee of unused
 * slots is refunded with their rewards on close (provisional policy: docs/plans/...).
 * Network and account costs (SOL) are not part of this quote and are shown separately.
 */
export function quoteEscrow(input: { rewardUnits: number; slots: number; feeBps: number }): EscrowQuote {
  const rewardUnits = units(input.rewardUnits, 'The reward', { positive: true });
  if (!Number.isSafeInteger(input.slots) || input.slots < 1 || input.slots > 500) throw new DomainError('VALIDATION', 'Slots must be a whole number from 1 to 500.');
  if (!Number.isSafeInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > MAX_FEE_BPS) throw new DomainError('VALIDATION', 'The fee must be 0–10000 basis points.');
  // rewardUnits ≤ 1e12 and feeBps ≤ 1e4: the product stays below 2^53.
  const perTestFeeUnits = Math.ceil((rewardUnits * input.feeBps) / MAX_FEE_BPS);
  // Integer ceil without trusting float division: correct it to the exact ceiling.
  const exactFee = (rewardUnits * input.feeBps) % MAX_FEE_BPS === 0 ? (rewardUnits * input.feeBps) / MAX_FEE_BPS : Math.floor((rewardUnits * input.feeBps) / MAX_FEE_BPS) + 1;
  if (exactFee !== perTestFeeUnits) throw new DomainError('INTERNAL', 'Fee rounding mismatch.');
  const perTestTotalUnits = rewardUnits + perTestFeeUnits;
  const rewardPoolUnits = rewardUnits * input.slots;
  const platformFeeUnits = perTestFeeUnits * input.slots;
  const totalUnits = units(rewardPoolUnits + platformFeeUnits, 'The study total');
  return { rewardUnits, slots: input.slots, feeBps: input.feeBps, perTestFeeUnits, perTestTotalUnits, rewardPoolUnits, platformFeeUnits, totalUnits };
}

const pair = (from: string, to: string, amount: number, kind: EscrowKind, studyId: string | null, participationId: string | null): EscrowPosting[] => [
  { account: from, amount: -amount, kind, studyId, participationId },
  { account: to, amount, kind, studyId, participationId },
];

export const vaultAccount = (studyId: string) => `vault:${studyId}`;
export const payableAccount = (participationId: string) => `payable:${participationId}`;
export const PLATFORM_FEES = 'fees:platform';

/** A verified funding transfer enters the study's vault. */
export function planFunding(input: { studyId: string; fundingId: string; amountUnits: number }): EscrowPosting[] {
  return pair('in:funding', vaultAccount(input.studyId), units(input.amountUnits, 'The funding', { positive: true }), 'funding', input.studyId, null);
}

/**
 * Approval authorizes exactly one payout: the reward moves to the participation's payable
 * account and the per-test fee is earned. `vaultAvailableIncludingThis` is the vault minus the
 * holds of *other* participations (this one's hold is what pays).
 */
export function planAuthorizePayout(input: { studyId: string; participationId: string; quote: EscrowQuote; vaultAvailableIncludingThis: number }): EscrowPosting[] {
  if (input.vaultAvailableIncludingThis < input.quote.perTestTotalUnits) {
    throw new DomainError('BUDGET_INSUFFICIENT', 'The study escrow cannot cover this reward.');
  }
  return [
    ...pair(vaultAccount(input.studyId), payableAccount(input.participationId), input.quote.rewardUnits, 'payout_authorized', input.studyId, input.participationId),
    ...(input.quote.perTestFeeUnits > 0 ? pair(vaultAccount(input.studyId), PLATFORM_FEES, input.quote.perTestFeeUnits, 'fee_earned', input.studyId, input.participationId) : []),
  ];
}

/** Only a payout confirmed on the settlement network leaves the payable account. */
export function planSettlePayout(input: { participationId: string; testerId: string; amountUnits: number }): EscrowPosting[] {
  return pair(payableAccount(input.participationId), `out:tester:${input.testerId}`, units(input.amountUnits, 'The payout', { positive: true }), 'payout_settled', null, input.participationId);
}

/** After close, everything left in the vault (unused rewards and their unearned fees) is refunded. */
export function planRefund(input: { studyId: string; builderId: string; vaultBalanceUnits: number }): EscrowPosting[] {
  if (!Number.isSafeInteger(input.vaultBalanceUnits) || input.vaultBalanceUnits < 0) throw new DomainError('INTERNAL', 'Escrow invariant violated: negative vault.');
  if (input.vaultBalanceUnits === 0) return [];
  return pair(vaultAccount(input.studyId), `out:refund:${input.builderId}`, input.vaultBalanceUnits, 'refund', input.studyId, null);
}

/** Each participation that holds budget holds one reward plus its fee. */
export function escrowAvailability(input: { vaultBalanceUnits: number; quote: EscrowQuote; holdingCount: number }) {
  const heldUnits = input.quote.perTestTotalUnits * input.holdingCount;
  const availableUnits = input.vaultBalanceUnits - heldUnits;
  if (availableUnits < 0) throw new DomainError('INTERNAL', 'Escrow invariant violated: reservations exceed the vault.');
  return { heldUnits, availableUnits, canReserve: availableUnits >= input.quote.perTestTotalUnits };
}

export type PayoutStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
export type PayoutAction = 'submit' | 'confirm' | 'fail';
const PAYOUT: Record<PayoutAction, Partial<Record<PayoutStatus, PayoutStatus>>> = {
  submit: { pending: 'submitted', failed: 'submitted' },
  confirm: { submitted: 'confirmed' },
  fail: { pending: 'failed', submitted: 'failed' },
};
/** `confirmed` is the only paid state and is final; a failed attempt is retried, never assumed paid. */
export function transitionPayout(from: PayoutStatus, action: PayoutAction): PayoutStatus {
  const to = PAYOUT[action][from];
  if (!to) throw conflict(`Cannot ${action} a payout that is ${from}.`);
  return to;
}

/** Server-owned expectation, fixed when the funding intent was created. */
export type FundingExpectation = { network: string; mint: string; vault: string; amountUnits: number; reference: string; notBeforeMs: number };
/** What the settlement network reports for a transfer signature (null: not found yet). */
export type ObservedTransfer = {
  status: 'processing' | 'finalized' | 'failed';
  network: string;
  mint: string;
  destination: string;
  amountUnits: number;
  reference: string;
  blockTimeMs: number | null;
};

/** Confirmed only for a finalized transfer that matches every field exactly. */
export function verifyFundingTransfer(expect: FundingExpectation, seen: ObservedTransfer | null): { status: 'pending' | 'confirmed' | 'failed'; reason: string | null } {
  if (!seen || seen.status === 'processing') return { status: 'pending', reason: null };
  if (seen.status === 'failed') return { status: 'failed', reason: 'The transfer failed on the network.' };
  if (seen.network !== expect.network) return { status: 'failed', reason: 'The transfer is on a different network.' };
  if (seen.mint !== expect.mint) return { status: 'failed', reason: 'The transfer is a different token.' };
  if (seen.destination !== expect.vault) return { status: 'failed', reason: 'The transfer went to a different address than the study escrow.' };
  if (seen.amountUnits !== expect.amountUnits) return { status: 'failed', reason: `The transfer amount is ${seen.amountUnits} units; the study needs exactly ${expect.amountUnits}.` };
  if (seen.reference !== expect.reference) return { status: 'failed', reason: 'The transfer belongs to a different funding request.' };
  if (seen.blockTimeMs === null || seen.blockTimeMs < expect.notBeforeMs) return { status: 'failed', reason: 'The transfer predates this funding request.' };
  return { status: 'confirmed', reason: null };
}
