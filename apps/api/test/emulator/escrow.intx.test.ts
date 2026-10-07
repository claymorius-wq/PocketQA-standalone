import { beforeEach, describe, expect, it } from 'vitest';
import { runTxCtx } from '../../src/firestore/tx';
import {
  authorizePayoutInTx,
  authorizeRefundInTx,
  awardApprovalInTx,
  C,
  canReserveInTx,
  createEscrowInTx,
  fundingStartedInTx,
  isFundedInTx,
  vaultBalanceInTx,
  walletFundedBuilderInTx,
} from '../../src/repo/escrow/firestore';
import type { ParticipationRow, StudyRow } from '../../src/views/studies';
import { clearEmulator, emulatorFirestore } from './fs';

// The escrow domain's in-transaction helpers (plan R9) that the studies domain composes into its
// decide, close, create and join transactions. Guards: plan r2 §R2 rows 16, 22, 24, 26, 27, 30.
const fs = emulatorFirestore();
beforeEach(clearEmulator);

const NOW = 1_800_000_000_000;
const study = (over: Partial<StudyRow> = {}): StudyRow => ({
  id: 's1',
  builder_id: 'b1',
  title: 'T',
  objective: 'O',
  build_under_test: null,
  device_criteria_json: '{}',
  reward_credits: 1_000_000,
  payment_mode: 'escrow',
  slots: 3,
  consent_text: 'c',
  consent_version: 1,
  status: 'published',
  moderation: 'ok',
  created_at: new Date(NOW).toISOString(),
  published_at: null,
  closed_at: null,
  ...over,
});
const part = (id: string, over: Partial<ParticipationRow> = {}): ParticipationRow => ({
  id,
  study_id: 's1',
  tester_id: `t-${id}`,
  status: 'submitted',
  consent_version: 1,
  consented_at: new Date(NOW).toISOString(),
  started_at: null,
  submitted_at: null,
  decided_at: null,
  decided_by: null,
  decision_reason: null,
  reward_credits: 1_000_000,
  payout_address: `wallet-${id}`,
  ...over,
});
const N = 20;
const count = async (c: keyof typeof C) => (await fs.collection(C[c]).get()).size;

/** An escrow study funded with its full quote (1,000,000 reward, 3 slots, 1000 bps fee). */
async function fundedStudy() {
  await runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', fee_bps: 1000, created_at: new Date(NOW).toISOString() }));
  // Funding is recorded by the repo's own funding verdict; here: its totals and wallet directly.
  const total = 3 * (1_000_000 + 100_000);
  await fs.collection(C.escrowBooks).doc('s1').set({ accounts: { 'in:funding': -total, 'vault:s1': total } });
  await fs.collection(C.studyEscrows).doc('s1').update({ funding_wallet: 'funder-1' });
  return total;
}

describe('createEscrowInTx (row 16: one vault per study)', () => {
  it(`${N} studies claiming one vault: exactly one escrow is created`, async () => {
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: `s${i}`, builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'one-vault', fee_bps: 0, created_at: 'x' })),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await count('studyEscrows')).toBe(1);
  });
});

describe('reads', () => {
  it('vault balance, canReserve against holds, funded and funding-started flags', async () => {
    const total = await fundedStudy();
    await runTxCtx(fs, async (t) => {
      expect(await vaultBalanceInTx(t, fs, 's1')).toBe(total);
      expect(await canReserveInTx(t, fs, study(), 2, NOW)).toBe(true);
      expect(await canReserveInTx(t, fs, study(), 3, NOW)).toBe(false);
      expect(await isFundedInTx(t, fs, 's1')).toBe(false);
      expect(await fundingStartedInTx(t, fs, 's1')).toBe(false);
    });
    await fs.collection(C.escrowFundings).doc('f1').set({ id: 'f1', study_id: 's1', status: 'expired' });
    await fs.collection(C.escrowFundings).doc('f2').set({ id: 'f2', study_id: 's1', status: 'pending' });
    expect(await runTxCtx(fs, (t) => fundingStartedInTx(t, fs, 's1'))).toBe(true);
  });
});

describe('authorizePayoutInTx (rows 22, 26)', () => {
  it(`${N} concurrent authorizations of one participation: one payout, one set of postings, balanced books`, async () => {
    const total = await fundedStudy();
    const p = part('p1');
    const results = await Promise.allSettled(Array.from({ length: N }, () => runTxCtx(fs, (t) => authorizePayoutInTx(t, fs, study(), p, 0, NOW, 'b1', 'approved', 'builder'))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await count('settlements')).toBe(1);
    expect(await count('escrowLedger')).toBe(4); // reward pair + fee pair
    const books = (await fs.collection(C.escrowBooks).doc('s1').get()).data()!.accounts as Record<string, number>;
    expect(books['vault:s1']).toBe(total - 1_100_000);
    expect(books['payable:p1']).toBe(1_000_000);
    expect(books['fees:platform']).toBe(100_000);
    expect(Object.values(books).reduce((a, b) => a + b, 0)).toBe(0);
    const audit = await fs.collection('audit').get();
    expect(audit.docs.map((d) => d.get('action'))).toEqual(['escrow.payout_authorized']);
  });

  it('refuses when other holds leave too little in the vault', async () => {
    await fundedStudy();
    await expect(runTxCtx(fs, (t) => authorizePayoutInTx(t, fs, study(), part('p1'), 3, NOW, 'b1', 'approved', 'builder'))).rejects.toThrow(/cannot cover/);
    expect(await count('settlements')).toBe(0);
  });
});

describe('authorizeRefundInTx (rows 24, 27)', () => {
  it(`${N} concurrent refunds on close: one refund of the whole vault to the funding wallet`, async () => {
    const total = await fundedStudy();
    const results = await Promise.allSettled(Array.from({ length: N }, () => runTxCtx(fs, (t) => authorizeRefundInTx(t, fs, study({ status: 'closed' }), NOW, 'b1', 'builder'))));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const settlements = await fs.collection(C.settlements).get();
    expect(settlements.size).toBe(1);
    expect(settlements.docs[0]!.data()).toMatchObject({ kind: 'refund', destination: 'funder-1', amount_units: total, status: 'pending' });
    // Once the vault is empty a later close is a no-op (amount 0: no guard, as SQLite's amount > 0).
    await runTxCtx(fs, (t) => authorizeRefundInTx(t, fs, study({ status: 'closed' }), NOW, 'b1', 'builder'));
    expect(await count('settlements')).toBe(1);
  });
});

describe('awardApprovalInTx (row 30: one award per participation and kind)', () => {
  it(`${N} concurrent approvals: one accepted and one helpful event, platform from the tester's device`, async () => {
    await fs.collection('users').doc('t-p1').set({ id: 't-p1', device_json: JSON.stringify({ platform: 'android' }) });
    const results = await Promise.allSettled(Array.from({ length: N }, () => runTxCtx(fs, (t) => awardApprovalInTx(t, fs, study(), part('p1'), true, NOW))));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true); // already awarded: a no-op, never an error
    const events = await fs.collection(C.pointsEvents).get();
    expect(events.docs.map((d) => d.get('kind')).sort()).toEqual(['accepted', 'helpful']);
    expect(events.docs.every((d) => d.get('platform') === 'android' && d.get('user_id') === 't-p1')).toBe(true);
    expect(await count('pointsAwards')).toBe(2);
  });

  it('self-dealing: a wallet that funded the same builder earns no points and is flagged once', async () => {
    await fs.collection(C.builderFundingWallets).doc('b1:wallet-p1').set({ builder_id: 'b1', wallet: 'wallet-p1' });
    await runTxCtx(fs, (t) => walletFundedBuilderInTx(t, fs, 'b1', 'wallet-p1').then((x) => expect(x).toBe(true)));
    await Promise.all(Array.from({ length: N }, () => runTxCtx(fs, (t) => awardApprovalInTx(t, fs, study(), part('p1'), true, NOW))));
    expect(await count('pointsEvents')).toBe(0);
    expect(await count('pointsFlags')).toBe(1);
  });

  it('composes with a payout authorization in one decide transaction', async () => {
    await fundedStudy();
    await runTxCtx(fs, async (t) => {
      await authorizePayoutInTx(t, fs, study(), part('p1'), 0, NOW, 'b1', 'approved', 'builder');
      await awardApprovalInTx(t, fs, study(), part('p1'), false, NOW);
    });
    expect(await count('settlements')).toBe(1);
    expect(await count('pointsEvents')).toBe(1);
  });
});
