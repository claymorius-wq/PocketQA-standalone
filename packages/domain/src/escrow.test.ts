import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  escrowAvailability,
  MAX_ESCROW_UNITS,
  planAuthorizePayout,
  planFunding,
  escrowInvariant,
  planAuthorizeRefund,
  planSettlePayout,
  planSettleFee,
  planSettleRefund,
  quoteEscrow,
  transitionPayout,
  verifyFundingTransfer,
  type EscrowPosting,
  type FundingExpectation,
  type ObservedTransfer,
} from './escrow';

const sum = (ps: EscrowPosting[]) => ps.reduce((s, p) => s + p.amount, 0);
const bal = (ps: EscrowPosting[], account: string) => ps.filter((p) => p.account === account).reduce((s, p) => s + p.amount, 0);
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'none';
};

describe('quoteEscrow: exact integer token units', () => {
  it('10 × 1 USDC with an illustrative 10% fee: pool 10, fee 1, total 11 (6-decimal units)', () => {
    expect(quoteEscrow({ rewardUnits: 1_000_000, slots: 10, feeBps: 1000 })).toEqual({
      rewardUnits: 1_000_000,
      slots: 10,
      feeBps: 1000,
      perTestFeeUnits: 100_000,
      perTestTotalUnits: 1_100_000,
      rewardPoolUnits: 10_000_000,
      platformFeeUnits: 1_000_000,
      totalUnits: 11_000_000,
    });
  });

  it('rounds a fractional per-test fee up to a whole unit, never with floating point', () => {
    // 333_333 × 10% = 33_333.3 → 33_334 per test; totals are per-test × slots exactly.
    const q = quoteEscrow({ rewardUnits: 333_333, slots: 3, feeBps: 1000 });
    expect(q.perTestFeeUnits).toBe(33_334);
    expect(q.platformFeeUnits).toBe(100_002);
    expect(q.totalUnits).toBe(q.rewardPoolUnits + q.platformFeeUnits);
  });

  it('a zero fee is allowed; non-integers, negatives and overflow are refused', () => {
    expect(quoteEscrow({ rewardUnits: 5, slots: 2, feeBps: 0 }).totalUnits).toBe(10);
    for (const bad of [
      { rewardUnits: 1.5, slots: 1, feeBps: 0 },
      { rewardUnits: 0, slots: 1, feeBps: 0 },
      { rewardUnits: -1, slots: 1, feeBps: 0 },
      { rewardUnits: 1, slots: 0, feeBps: 0 },
      { rewardUnits: 1, slots: 1, feeBps: -1 },
      { rewardUnits: 1, slots: 1, feeBps: 10_001 },
      { rewardUnits: MAX_ESCROW_UNITS, slots: 2, feeBps: 0 },
      { rewardUnits: Number.MAX_SAFE_INTEGER, slots: 1, feeBps: 1 },
    ]) {
      expect(code(() => quoteEscrow(bad)), JSON.stringify(bad)).toBe('VALIDATION');
    }
  });
});

describe('escrow postings', () => {
  const q = quoteEscrow({ rewardUnits: 1_000_000, slots: 2, feeBps: 1000 });

  it('every plan is balanced and moves only whole units', () => {
    const plans = [
      planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: q.totalUnits }),
      planAuthorizePayout({ studyId: 's1', participationId: 'p1', quote: q, vaultAvailableIncludingThis: q.totalUnits }),
      planSettlePayout({ studyId: 's1', participationId: 'p1', testerId: 't1', amountUnits: q.rewardUnits }),
      planAuthorizeRefund({ studyId: 's1', vaultBalanceUnits: 1_100_000 }),
      planSettleRefund({ studyId: 's1', funder: 'W1', amountUnits: 1_100_000 }),
    ];
    for (const p of plans) {
      expect(sum(p)).toBe(0);
      for (const x of p) expect(Number.isSafeInteger(x.amount)).toBe(true);
    }
  });

  it('funding → approval → settlement → refund leaves the vault at zero and pays exactly once', () => {
    let ledger: EscrowPosting[] = planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: q.totalUnits });
    expect(bal(ledger, 'vault:s1')).toBe(2_200_000);
    ledger = [...ledger, ...planAuthorizePayout({ studyId: 's1', participationId: 'p1', quote: q, vaultAvailableIncludingThis: 2_200_000 })];
    expect(bal(ledger, 'payable:p1')).toBe(1_000_000);
    expect(bal(ledger, 'fees:platform')).toBe(100_000);
    ledger = [...ledger, ...planSettlePayout({ studyId: 's1', participationId: 'p1', testerId: 't1', amountUnits: 1_000_000 })];
    expect(bal(ledger, 'payable:p1')).toBe(0);
    expect(bal(ledger, 'out:tester:t1')).toBe(1_000_000);
    // The second slot was never used: its reward and unearned fee are refunded to the funding
    // wallet, first pending, then settled.
    ledger = [...ledger, ...planAuthorizeRefund({ studyId: 's1', vaultBalanceUnits: bal(ledger, 'vault:s1') })];
    expect(bal(ledger, 'vault:s1')).toBe(0);
    expect(bal(ledger, 'refund_pending:s1')).toBe(1_100_000);
    ledger = [...ledger, ...planSettleRefund({ studyId: 's1', funder: 'W1', amountUnits: 1_100_000 })];
    expect(bal(ledger, 'refund_pending:s1')).toBe(0);
    expect(bal(ledger, 'out:refund:W1')).toBe(1_100_000);
  });

  it('an approval the vault cannot cover is refused (never a negative vault)', () => {
    expect(code(() => planAuthorizePayout({ studyId: 's1', participationId: 'p1', quote: q, vaultAvailableIncludingThis: q.perTestTotalUnits - 1 }))).toBe('BUDGET_INSUFFICIENT');
  });

  it('refund of a negative or non-integer vault is an invariant error; zero refunds nothing', () => {
    expect(planAuthorizeRefund({ studyId: 's1', vaultBalanceUnits: 0 })).toEqual([]);
    expect(code(() => planAuthorizeRefund({ studyId: 's1', vaultBalanceUnits: -1 }))).toBe('INTERNAL');
    expect(code(() => planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: 0.5 }))).toBe('VALIDATION');
  });
});

describe('escrowAvailability: reservations never exceed confirmed funds', () => {
  const q = quoteEscrow({ rewardUnits: 1_000_000, slots: 3, feeBps: 1000 });
  it('each holding participation holds one reward plus its fee', () => {
    const a = escrowAvailability({ vaultBalanceUnits: q.totalUnits, quote: q, holdingCount: 2 });
    expect(a).toEqual({ heldUnits: 2_200_000, availableUnits: 1_100_000, canReserve: true });
    expect(escrowAvailability({ vaultBalanceUnits: q.totalUnits, quote: q, holdingCount: 3 }).canReserve).toBe(false);
  });
  it('an unfunded or underfunded vault reserves nothing', () => {
    expect(escrowAvailability({ vaultBalanceUnits: 0, quote: q, holdingCount: 0 }).canReserve).toBe(false);
    expect(escrowAvailability({ vaultBalanceUnits: q.perTestTotalUnits - 1, quote: q, holdingCount: 0 }).canReserve).toBe(false);
  });
  it('holds above the vault are an invariant error', () => {
    expect(code(() => escrowAvailability({ vaultBalanceUnits: 1_100_000, quote: q, holdingCount: 2 }))).toBe('INTERNAL');
  });
});

describe('payout state machine', () => {
  it('only confirmed is paid; failure retries; confirmed is final', () => {
    expect(transitionPayout('pending', 'submit')).toBe('submitted');
    expect(transitionPayout('submitted', 'confirm')).toBe('confirmed');
    expect(transitionPayout('submitted', 'fail')).toBe('failed');
    expect(transitionPayout('failed', 'submit')).toBe('submitted');
    expect(transitionPayout('pending', 'fail')).toBe('failed'); // e.g. the submitter could not send
    for (const [from, action] of [
      ['confirmed', 'submit'],
      ['confirmed', 'fail'],
      ['confirmed', 'confirm'],
      ['pending', 'confirm'],
      ['failed', 'confirm'],
    ] as const) {
      expect(code(() => transitionPayout(from, action)), `${from}+${action}`).toBe('CONFLICT_STATE');
    }
  });
});

describe('verifyFundingTransfer: exact network, mint, recipient, amount and reference', () => {
  const expect0: FundingExpectation = { network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', amountUnits: 11_000_000, reference: 'ref-1', notBeforeMs: 1_000 };
  const ok: ObservedTransfer = { status: 'finalized', network: 'simulated', mint: 'SIM-USDC', destination: 'sim-vault:s1', amountUnits: 11_000_000, reference: 'ref-1', blockTimeMs: 2_000 };

  it('confirms only an exact, finalized match', () => {
    expect(verifyFundingTransfer(expect0, ok)).toEqual({ status: 'confirmed', reason: null });
  });
  it('waits while the transfer is unfinalized or not found yet', () => {
    expect(verifyFundingTransfer(expect0, { ...ok, status: 'processing' }).status).toBe('pending');
    expect(verifyFundingTransfer(expect0, null).status).toBe('pending');
  });
  it.each([
    ['wrong network', { network: 'solana:mainnet' }],
    ['wrong mint', { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }],
    ['wrong recipient', { destination: 'sim-vault:other' }],
    ['insufficient amount', { amountUnits: 10_999_999 }],
    ['overpayment', { amountUnits: 11_000_001 }],
    ['another intent’s reference', { reference: 'ref-2' }],
    ['a transfer older than the intent', { blockTimeMs: 999 }],
    ['a failed transfer', { status: 'failed' }],
  ] as const)('fails: %s', (_, patch) => {
    const v = verifyFundingTransfer(expect0, { ...ok, ...(patch as Partial<ObservedTransfer>) });
    expect(v.status).toBe('failed');
    expect(v.reason).toBeTruthy();
  });
});

describe('escrowInvariant: every funded unit is accounted for in exactly one place', () => {
  const q = quoteEscrow({ rewardUnits: 1_000_000, slots: 3, feeBps: 1000 });
  const steps: EscrowPosting[][] = [
    planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: q.totalUnits }),
    planAuthorizePayout({ studyId: 's1', participationId: 'p1', quote: q, vaultAvailableIncludingThis: q.totalUnits }),
    planAuthorizePayout({ studyId: 's1', participationId: 'p2', quote: q, vaultAvailableIncludingThis: q.totalUnits - q.perTestTotalUnits }),
    planSettlePayout({ studyId: 's1', participationId: 'p1', testerId: 't1', amountUnits: q.rewardUnits }),
    planAuthorizeRefund({ studyId: 's1', vaultBalanceUnits: q.perTestTotalUnits }),
    planSettleRefund({ studyId: 's1', funder: 'W1', amountUnits: q.perTestTotalUnits }),
  ];
  it('holds after every step: funded = available + held + payable + settled + fees + pending refund + refunded', () => {
    let ledger: EscrowPosting[] = [];
    for (const [i, step] of steps.entries()) {
      ledger = [...ledger, ...step];
      const inv = escrowInvariant({ studyId: 's1', postings: ledger, quote: q, holdingCount: 0 });
      expect(inv.ok, `step ${i}: ${JSON.stringify(inv)}`).toBe(true);
    }
    const end = escrowInvariant({ studyId: 's1', postings: ledger, quote: q, holdingCount: 0 });
    expect(end).toMatchObject({ fundedUnits: 3_300_000, availableUnits: 0, heldUnits: 0, payableUnits: 1_000_000, settledUnits: 1_000_000, feesUnits: 200_000, pendingRefundUnits: 0, refundedUnits: 1_100_000, ok: true });
  });
  it('counts held reservations inside the vault, not on top of it', () => {
    const funded = planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: q.totalUnits });
    expect(escrowInvariant({ studyId: 's1', postings: funded, quote: q, holdingCount: 2 })).toMatchObject({ availableUnits: 1_100_000, heldUnits: 2_200_000, ok: true });
  });
  it('detects a posting outside the escrow accounts', () => {
    const bad: EscrowPosting[] = [...planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: 100 }), { account: 'vault:s1', amount: -1, kind: 'refund_authorized', studyId: 's1', participationId: null }];
    expect(escrowInvariant({ studyId: 's1', postings: bad, quote: q, holdingCount: 0 }).ok).toBe(false);
  });
});

describe('the fee sweep on close (devnet decision (a)): earned fees leave the vault to the platform fee wallet', () => {
  const q = quoteEscrow({ rewardUnits: 1_000_000, slots: 3, feeBps: 1000 });
  const closed: EscrowPosting[] = [
    ...planFunding({ studyId: 's1', fundingId: 'f1', amountUnits: q.totalUnits }),
    ...planAuthorizePayout({ studyId: 's1', participationId: 'p1', quote: q, vaultAvailableIncludingThis: q.totalUnits }),
    ...planSettlePayout({ studyId: 's1', participationId: 'p1', testerId: 't1', amountUnits: q.rewardUnits }),
    ...planAuthorizeRefund({ studyId: 's1', vaultBalanceUnits: 2 * q.perTestTotalUnits }),
    ...planSettleRefund({ studyId: 's1', funder: 'W1', amountUnits: 2 * q.perTestTotalUnits }),
  ];
  it('a balanced fee_settled pair: fees:platform to out:fees:<wallet>', () => {
    expect(planSettleFee({ studyId: 's1', feeWallet: 'FEE', amountUnits: 100_000 })).toEqual([
      { account: 'fees:platform', amount: -100_000, kind: 'fee_settled', studyId: 's1', participationId: null },
      { account: 'out:fees:FEE', amount: 100_000, kind: 'fee_settled', studyId: 's1', participationId: null },
    ]);
  });
  it('the invariant holds after the sweep, with the swept fees in their own bucket and nothing left earned-but-unswept', () => {
    const swept = [...closed, ...planSettleFee({ studyId: 's1', feeWallet: 'FEE', amountUnits: q.perTestFeeUnits })];
    expect(escrowInvariant({ studyId: 's1', postings: closed, quote: q, holdingCount: 0 })).toMatchObject({ feesUnits: 100_000, sweptFeesUnits: 0, ok: true });
    expect(escrowInvariant({ studyId: 's1', postings: swept, quote: q, holdingCount: 0 })).toMatchObject({ fundedUnits: 3_300_000, feesUnits: 0, sweptFeesUnits: 100_000, settledUnits: 1_000_000, refundedUnits: 2_200_000, ok: true });
  });
  it('refuses a non-positive or unsafe amount', () => {
    for (const amountUnits of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => planSettleFee({ studyId: 's1', feeWallet: 'FEE', amountUnits })).toThrow();
  });
});
