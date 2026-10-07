import { beforeEach, describe, expect, it } from 'vitest';
import { runTxCtx } from '../../src/firestore/tx';
import { makeRepos } from '../../src/repo';
import { authorizePayoutInTx, C, createEscrowInTx, firestoreEscrowRepo } from '../../src/repo/escrow/firestore';
import { SimulatedSettlement } from '../../src/settlement/simulated';
import { runSettlement } from '../../src/settlement/worker';
import { fail } from '../../src/util';
import type { UserRow } from '../../src/views/core';
import type { ParticipationRow, StudyRow } from '../../src/views/studies';
import { clearEmulator, emulatorFirestore } from './fs';

// The native Firestore escrow repository (plan r2 §R2 rows 12–33): guards under ≥ 20-way races,
// the settlement worker over Firestore with the simulator persisting through the repo (hosted
// staging), export, and an idempotent purge.
const fs = emulatorFirestore();
const repo = firestoreEscrowRepo(fs);
const repos = makeRepos({ kind: 'firestore', fs });
beforeEach(clearEmulator);

const N = 20;
const NOW = 1_800_000_000_000;
const ISO = new Date(NOW).toISOString();
const count = async (c: keyof typeof C) => (await fs.collection(C[c]).get()).size;
const ok = () => undefined;

const user = (id: string, role: UserRow['role'] = 'tester'): UserRow => ({ id, email: `${id}@example.test`, password_hash: 'x', display_name: id, role, status: 'active', device_json: JSON.stringify({ platform: 'android' }), created_at: ISO });
const study = (over: Partial<StudyRow> = {}): StudyRow => ({
  id: 's1', builder_id: 'b1', title: 'Checkout test', objective: 'o', build_under_test: null, device_criteria_json: '{}', reward_credits: 1_000_000,
  payment_mode: 'escrow', slots: 2, consent_text: 'c', consent_version: 1, status: 'draft', moderation: 'ok', created_at: ISO, published_at: null, closed_at: null, ...over,
});
const part = (id: string, over: Partial<ParticipationRow> = {}): ParticipationRow => ({
  id, study_id: 's1', tester_id: `t-${id}`, status: 'approved', consent_version: 1, consented_at: ISO, started_at: null, submitted_at: null,
  decided_at: ISO, decided_by: 'b1', decision_reason: null, reward_credits: 1_000_000, payout_address: `wallet-t-${id}`, ...over,
});

/** Seeds the studies-domain documents this domain reads (pqa-be1's shapes). */
async function seed(s: StudyRow, parts: ParticipationRow[] = []) {
  await fs.collection('users').doc(s.builder_id).set(user(s.builder_id, 'builder'));
  await fs.collection('studies').doc(s.id).set(s);
  for (const p of parts) {
    await fs.collection('participations').doc(p.id).set(p);
    await fs.collection('users').doc(p.tester_id).set(user(p.tester_id));
  }
}

/** A draft escrow study with a linked builder wallet and a confirmed (simulated) funding. */
async function fundedDraft() {
  await seed(study());
  await runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', fee_bps: 1000, created_at: ISO }));
  await fs.collection(C.walletLinks).doc('b1').set({ user_id: 'b1', address: 'funder-1', linked_at: ISO });
  await fs.collection(C.walletAddresses).doc('funder-1').set({ user_id: 'b1' });
  const f = await repo.openFunding({ studyId: 's1', user: user('b1', 'builder'), nowMs: NOW, reference: 'ref-1', ttlMs: 60_000 });
  const confirmed = await repo.recordFundingVerdict({ fundingId: f.id, signature: 'sig-fund-1', verdict: { status: 'confirmed', reason: null }, source: 'funder-1', nowMs: NOW, actorId: 'b1', label: 'simulated settlement' });
  expect(confirmed.status).toBe('confirmed');
  return f;
}

describe('(a) export and purge', () => {
  it('exportUser: the builder’s funding and the tester’s payout and points, in the shared export shape', async () => {
    await fundedDraft();
    await fs.collection('studies').doc('s1').update({ status: 'published' });
    const p = part('p1');
    await seed(study({ status: 'published' }), [p]);
    await runTxCtx(fs, (t) => authorizePayoutInTx(t, fs, study({ status: 'published' }), p, 0, NOW, 'b1', 'approved', 'builder'));
    const b = await repo.exportUser('b1', NOW);
    expect(b.payments.fundings).toEqual([expect.objectContaining({ studyId: 's1', amountUnits: '2200000', status: 'confirmed', settlement: 'simulated', source: 'funder-1' })]);
    expect(b.payments.studyPayments).toEqual([expect.objectContaining({ studyId: 's1', amountUnits: '1000000', feeUnits: '100000', status: 'pending' })]);
    const tt = await repo.exportUser('t-p1', NOW);
    expect(tt.payments.received).toEqual([expect.objectContaining({ participationId: 'p1', studyTitle: 'Checkout test', amountUnits: '1000000', destination: 'wallet-t-p1' })]);
    expect(tt.reputation).toMatchObject({ points: 0, noCashValue: true, leaderboard: { optedIn: false, alias: null } });
  });

  it('purgeUser: link, nonces, transfers, leaderboard go; a draft escrow is refunded by the arbiter; rerun is a no-op', async () => {
    await fundedDraft();
    await repo.createLinkNonce({ nonce: 'n1', userId: 'b1', address: 'funder-1', inputJson: '{}', expiresAtMs: NOW + 1 });
    await repo.putLeaderboard('b1', true, 'Builder', NOW);
    await repo.createTransfer({ id: 'x1', participation_id: 'p9', builder_id: 'b1', tester_id: 't9', sender: 'a', recipient: 'b', lamports: 1, created_at: ISO, expires_at: ISO });
    for (let i = 0; i < 2; i++) expect(await repo.purgeUser('b1', NOW)).toEqual({ mediaKeys: [] });
    for (const c of ['walletLinks', 'walletAddresses', 'walletNonces', 'devnetTransfers', 'openTransfers', 'leaderboardProfiles', 'leaderboardAliases'] as const) expect(await count(c), c).toBe(0);
    const refunds = (await fs.collection(C.settlements).where('kind', '==', 'refund').get()).docs.map((d) => d.data());
    expect(refunds).toEqual([expect.objectContaining({ destination: 'funder-1', amount_units: 2_200_000, cosigner: 'arbiter' })]);
  });
});

describe('(b) settlement worker over Firestore, simulator through the repo', () => {
  async function approved() {
    await fundedDraft();
    const s = study({ status: 'published' });
    const p = part('p1');
    await seed(s, [p]);
    await runTxCtx(fs, (t) => authorizePayoutInTx(t, fs, s, p, 0, NOW, 'b1', 'approved', 'builder'));
  }
  const deps = () => ({ repo: repos, now: () => NOW, settlement: new SimulatedSettlement(repos, () => NOW) });

  it('pays once and settles once; books balance', async () => {
    await approved();
    await runSettlement(deps());
    await runSettlement(deps());
    const [x] = (await fs.collection(C.settlements).get()).docs.map((d) => d.data());
    expect(x).toMatchObject({ kind: 'payout', status: 'confirmed', attempt: 1 });
    expect((await fs.collection(C.simChainTransfers).where('kind', '==', 'payout').get()).size).toBe(1);
    expect(await repo.studyBooks('s1', NOW)).toMatchObject({ settledUnits: 1_000_000, payableUnits: 0, feesUnits: 100_000, ok: true });
  });

  it(`${N} concurrent worker runs: one transfer per attempt key, one settle posting (rows 23, 28, 29)`, async () => {
    await approved();
    await Promise.allSettled(Array.from({ length: N }, () => runSettlement(deps())));
    await runSettlement(deps());
    expect((await fs.collection(C.simChainTransfers).where('kind', '==', 'payout').get()).size).toBe(1);
    expect((await fs.collection(C.escrowLedger).where('kind', '==', 'payout_settled').get()).size).toBe(2);
    expect(await repo.studyBooks('s1', NOW)).toMatchObject({ settledUnits: 1_000_000, ok: true });
  });

  it(`simRecordTransfer: ${N} sends with one idempotency key record one transfer and agree on its signature (row 29)`, async () => {
    const sim = new SimulatedSettlement(repos, () => NOW);
    const sigs = await Promise.all(Array.from({ length: N }, () => sim.sendTransfer({ source: 'v', destination: 'd', amountUnits: 1, reference: 'k' }, 'payout', 'k1')));
    expect(new Set(sigs).size).toBe(1);
    expect(await count('simChainTransfers')).toBe(1);
  });

  it('expires unpaid fundings past their expiry only', async () => {
    await seed(study());
    await runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', fee_bps: 0, created_at: ISO }));
    await fs.collection(C.walletLinks).doc('b1').set({ user_id: 'b1', address: 'w', linked_at: ISO });
    const f = await repo.openFunding({ studyId: 's1', user: user('b1', 'builder'), nowMs: NOW, reference: 'r', ttlMs: 1000 });
    await repo.expireUnpaidFundings(NOW + 999);
    expect((await repo.fundingById(f.id))!.status).toBe('awaiting_payment');
    await repo.expireUnpaidFundings(NOW + 1000);
    expect((await repo.fundingById(f.id))!.status).toBe('expired');
  });
});

describe('(c) fundings, leaderboard aliases, fraud', () => {
  it(`rule G: ${N} concurrent funding requests for one study share one open request (row 18)`, async () => {
    await seed(study());
    await runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', fee_bps: 0, created_at: ISO }));
    await fs.collection(C.walletLinks).doc('b1').set({ user_id: 'b1', address: 'w', linked_at: ISO });
    const fs_ = await Promise.all(Array.from({ length: N }, (_, i) => repo.openFunding({ studyId: 's1', user: user('b1', 'builder'), nowMs: NOW, reference: `ref-${i}`, ttlMs: 60_000 })));
    expect(new Set(fs_.map((f) => f.id)).size).toBe(1);
    expect(await count('escrowFundings')).toBe(1);
  });

  it(`${N} concurrent confirmations of one funding credit the vault once (rows 19–21)`, async () => {
    await seed(study());
    await runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', fee_bps: 1000, created_at: ISO }));
    await fs.collection(C.walletLinks).doc('b1').set({ user_id: 'b1', address: 'funder-1', linked_at: ISO });
    const f = await repo.openFunding({ studyId: 's1', user: user('b1', 'builder'), nowMs: NOW, reference: 'ref', ttlMs: 60_000 });
    await Promise.allSettled(Array.from({ length: N }, () => repo.recordFundingVerdict({ fundingId: f.id, signature: 'sig', verdict: { status: 'confirmed', reason: null }, source: 'funder-1', nowMs: NOW, actorId: 'b1', label: 'sim' })));
    expect((await repo.studyBooks('s1', NOW)).fundedUnits).toBe(2_200_000);
    expect((await fs.collection(C.escrowLedger).where('kind', '==', 'funding').get()).size).toBe(2);
    expect(await repo.isFunded('s1')).toBe(true);
    expect(await repo.fundingSignatureUsedElsewhere('sig', 'another')).toBe(true);
  });

  it(`${N} users claiming one alias, any letter case: one wins (row 32); a rename frees it, opting out keeps it`, async () => {
    const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => repo.putLeaderboard(`u${i}`, true, i % 2 ? 'Speedy' : 'speedy', NOW)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = (await fs.collection(C.leaderboardProfiles).get()).docs[0]!.id;
    await repo.putLeaderboard(winner, false, undefined, NOW); // opt out: the alias stays reserved
    await expect(repo.putLeaderboard('other', true, 'SPEEDY', NOW)).rejects.toThrow(/taken/);
    await repo.putLeaderboard(winner, true, 'Renamed', NOW);
    await repo.putLeaderboard('other', true, 'SPEEDY', NOW);
    expect(await count('leaderboardAliases')).toBe(2);
  });

  it(`upholdFraud: ${N} concurrent (retried) admin decisions reverse the points once (rows 30, 31)`, async () => {
    const p = part('p1');
    await seed(study({ status: 'published' }), [p]);
    await fs.collection(C.pointsEvents).doc('p1:accepted').set({ id: 'p1:accepted', user_id: 't-p1', participation_id: 'p1', kind: 'accepted', points: 10, reverses_id: null, platform: 'android', created_at: ISO, ord: 0 });
    const results = await Promise.allSettled(Array.from({ length: N }, () => repo.upholdFraud('p1', 'Recording reused from another study.', 'admin', NOW)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => /already marked/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect((await fs.collection(C.pointsEvents).where('kind', '==', 'reversal').get()).size).toBe(1);
    expect((await repo.reputationOf('t-p1', NOW)).points).toBe(0);
  });
});

describe('(d) wallet links and devnet transfers', () => {
  it(`${N} users linking one address: one link (row 13); relinking moves the guard; unlink frees it`, async () => {
    for (let i = 0; i < N; i++) await repo.createLinkNonce({ nonce: `n${i}`, userId: `u${i}`, address: 'addr', inputJson: '{}', expiresAtMs: NOW + 1 });
    const outcomes = await Promise.all(Array.from({ length: N }, (_, i) => repo.linkWallet({ userId: `u${i}`, address: 'addr', nonce: `n${i}`, nowMs: NOW, verify: ok })));
    expect(outcomes.filter((o) => o === null)).toHaveLength(1);
    const owner = (await fs.collection(C.walletAddresses).doc('addr').get()).data()!.user_id as string;
    expect((await fs.collection(C.walletNonces).where('used_at', '==', NOW).get()).size).toBe(N); // every attempt burned its nonce
    await repo.createLinkNonce({ nonce: 'm', userId: owner, address: 'addr2', inputJson: '{}', expiresAtMs: NOW + 1 });
    expect(await repo.linkWallet({ userId: owner, address: 'addr2', nonce: 'm', nowMs: NOW, verify: ok })).toBeNull();
    expect((await fs.collection(C.walletAddresses).doc('addr').get()).exists).toBe(false);
    expect(await repo.unlinkWallet({ id: owner, hasPassword: true })).toBe(true);
    expect(await count('walletAddresses')).toBe(0);
  });

  it('a failed verification still burns the nonce and links nothing', async () => {
    await repo.createLinkNonce({ nonce: 'n', userId: 'u', address: 'a', inputJson: '{}', expiresAtMs: NOW + 1 });
    const err = await repo.linkWallet({ userId: 'u', address: 'a', nonce: 'n', nowMs: NOW, verify: () => { throw fail('VALIDATION', 'bad signature'); } });
    expect(err?.message).toMatch(/bad signature/);
    expect((await fs.collection(C.walletNonces).doc('n').get()).data()!.used_at).toBe(NOW);
    expect(await count('walletLinks')).toBe(0);
  });

  it(`${N} transfers for one participation: one open (row 15); expiry releases it; signatures are unique (row 14)`, async () => {
    const mk = (id: string) => ({ id, participation_id: 'p1', builder_id: 'b1', tester_id: 't1', sender: 'a', recipient: 'b', lamports: 1, created_at: ISO, expires_at: ISO });
    const made = await Promise.all(Array.from({ length: N }, (_, i) => repo.createTransfer(mk(`x${i}`))));
    const first = made.filter(Boolean);
    expect(first).toHaveLength(1);
    await repo.expireTransfer(first[0]!.id, 'No signature was submitted in time.');
    const second = (await repo.createTransfer(mk('y')))!;
    expect(second).not.toBeNull();
    expect((await repo.attachTransferSignature('y', 'sig', ISO))!.status).toBe('pending');
    await repo.createTransfer({ ...mk('z'), participation_id: 'p2' });
    expect(await repo.attachTransferSignature('z', 'sig', ISO)).toBeNull();
  });
});

describe('plan R12 retries (P2-F): an existing effect is returned, never repeated', () => {
  it('createTransfer (rule D): the same id again returns the existing transfer, even after it moved on', async () => {
    const row = { id: 'i-deterministic', participation_id: 'p1', builder_id: 'b1', tester_id: 't1', sender: 'a', recipient: 'b', lamports: 1, created_at: ISO, expires_at: ISO };
    const first = (await repo.createTransfer(row))!;
    await repo.attachTransferSignature(first.id, 'sig', ISO);
    const again = await Promise.all(Array.from({ length: N }, () => repo.createTransfer(row)));
    expect(again.every((x) => x?.id === first.id && x.status === 'pending')).toBe(true);
    expect(await count('devnetTransfers')).toBe(1);
  });

  it('openFunding (rule G): a retry after commit returns the open request, with no second request or reference', async () => {
    await seed(study());
    await runTxCtx(fs, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'simulated', network: 'simulated', mint: 'SIM-USDC', vault: 'sim-vault:s1', fee_bps: 0, created_at: ISO }));
    await fs.collection(C.walletLinks).doc('b1').set({ user_id: 'b1', address: 'w', linked_at: ISO });
    const first = await repo.openFunding({ studyId: 's1', user: user('b1', 'builder'), nowMs: NOW, reference: 'ref-a', ttlMs: 60_000 });
    const retry = await repo.openFunding({ studyId: 's1', user: user('b1', 'builder'), nowMs: NOW + 1, reference: 'ref-b', ttlMs: 60_000 });
    expect(retry).toEqual(first);
    expect(await count('escrowFundings')).toBe(1);
    expect(await count('fundingRefs')).toBe(1);
  });
});
