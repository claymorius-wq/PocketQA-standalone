import { afterEach, beforeEach, expect, it } from 'vitest';
import { Study } from '@pocket-qa/contracts';
import { studyEscrowBooks } from '../src/escrow';
import { runSettlement } from '../src/settlement/worker';
import { DEVICE, makeApp, STUDY, type TestApp } from './helpers';
import { FakeSquadsChain } from './fakeSquadsChain';

// The whole escrow flow through the Squads devnet pilot adapter over the in-memory chain: the
// API, the worker and the ledger are the same as for the simulation; only the provider differs.
// Covers pqa-qa devnet matrix R2 to R7 and C8 offline (the live run covers them on devnet).
let t: TestApp;
let chain: FakeSquadsChain;
const USDC = 1_000_000;
beforeEach(async () => {
  chain = new FakeSquadsChain();
  t = await makeApp({ settlement: 'squads_devnet', squadsChain: chain });
  chain.blockTimeMs = t.clock.now + 1000;
});
afterEach(async () => t?.close());

const books = (studyId: string) => studyEscrowBooks(t.db, studyId, t.clock.now);
const tokens = (owner: string) => chain.balances.get(chain.ataOf(owner)) ?? 0;

async function fundedStudy(slots = 3) {
  const b = await t.register('builder');
  const w = await t.linkWallet(b.token, chain.seedOf('builder'));
  expect(w.address).toBe(chain.keys.builder);
  const { rewardCredits: _, ...rest } = STUDY;
  const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
  const f = (await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body;
  expect(f).toMatchObject({ settlement: 'squads_devnet', network: 'solana:devnet', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' });
  // The simulator's stand-in wallet doesn't exist here: the builder's wallet sends on its own.
  expect((await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).status).toBe(403);
  const sig = chain.recordFunding({ from: chain.keys.builder, toAta: f.vault, amount: f.amountUnits, reference: f.reference });
  const confirmed = (await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: sig })).body;
  expect(confirmed).toMatchObject({ status: 'confirmed', source: chain.keys.builder });
  expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).status).toBe(200);
  return { b, study, vault: f.vault as string };
}

async function submitted(studyId: string) {
  const u = await t.register('tester');
  await t.req('PUT', '/me/device', u.token, DEVICE);
  const w = await t.linkWallet(u.token);
  const p = (await t.req('POST', `/studies/${studyId}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: w.address })).body;
  await t.req('POST', `/participations/${p.id}/start`, u.token);
  await t.req('POST', `/participations/${p.id}/submit`, u.token);
  return { u, pid: p.id as string, wallet: w.address };
}

it('funding, an approved payout, an overturned dispute co-signed by the arbiter, and the refund settle on chain exactly once', async () => {
  const { b, study, vault } = await fundedStudy();
  expect(t.db.prepare('SELECT multisig, vault_authority FROM study_escrows WHERE study_id = ?').get(study.id)).toEqual({ multisig: expect.any(String), vault_authority: expect.any(String) });
  expect(chain.balances.get(vault)).toBe(3_300_000);

  const one = await submitted(study.id);
  await t.req('POST', `/participations/${one.pid}/approve`, b.token, { helpful: true });
  const two = await submitted(study.id);
  await t.req('POST', `/participations/${two.pid}/reject`, b.token, { reason: 'The recording does not show the tasks.' });
  const d = (await t.req('POST', '/disputes', two.u.token, { participationId: two.pid, reason: 'I recorded every task as asked.' })).body;
  const a = await t.admin();
  await t.req('POST', `/admin/disputes/${d.id}/resolve`, a.token, { outcome: 'overturned', note: 'Evidence shows the tasks.' });

  expect((await runSettlement(t.deps)).alerts).toEqual([]);
  expect((await runSettlement(t.deps)).alerts).toEqual([]);
  expect(tokens(one.wallet)).toBe(USDC);
  expect(tokens(two.wallet)).toBe(USDC);
  // The approved payout was co-signed by the builder; the overturned one by the arbiter.
  const approvals = chain.sent.filter((s) => s.step.startsWith('approve:')).map((s) => s.step);
  expect(approvals.sort()).toEqual(['approve:arbiter', 'approve:builder', 'approve:pocketqa', 'approve:pocketqa']);
  expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(2);

  expect((await t.req('POST', `/studies/${study.id}/close`, b.token)).status).toBe(200);
  await runSettlement(t.deps);
  expect((await runSettlement(t.deps)).alerts).toEqual([]);
  expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(3);
  // The refund (the unused slot's reward and fee) went to the funding wallet; the two fees stay in the vault.
  expect(tokens(chain.keys.builder)).toBe(50_000_000 - 3_300_000 + 1_100_000);
  expect(chain.balances.get(vault)).toBe(200_000);
  // C8: the ledger matches the chain.
  expect(books(study.id)).toMatchObject({ fundedUnits: 3_300_000, settledUnits: 2 * USDC, feesUnits: 200_000, refundedUnits: 1_100_000, payableUnits: 0, pendingRefundUnits: 0, ok: true });
  const payouts = t.db.prepare(`SELECT status, signature FROM settlements WHERE study_id = ? ORDER BY kind`).all(study.id) as { status: string; signature: string }[];
  expect(payouts.every((p) => p.status === 'confirmed' && chain.sent.some((s) => s.step === 'execute' && s.signature === p.signature))).toBe(true);
  // Every money view names the pilot; none calls it simulated.
  const s = (await t.req('GET', `/studies/${study.id}`, b.token)).body;
  expect(s.payment).toMatchObject({ settlement: 'squads_devnet', refund: { status: 'confirmed' } });
  const mine = (await t.req('GET', '/me/payouts', one.u.token)).body.items;
  expect(mine).toEqual([expect.objectContaining({ settlement: 'squads_devnet', status: 'confirmed', destination: one.wallet })]);
});

it('a crash after the execute landed re-drives the same Squads transaction: no second transfer', async () => {
  const { b, study } = await fundedStudy();
  const one = await submitted(study.id);
  await t.req('POST', `/participations/${one.pid}/approve`, b.token, { helpful: false });
  chain.crashAfter = 'execute';
  await expect(runSettlement(t.deps)).rejects.toThrow(/simulated crash/);
  chain.crashAfter = null;
  await runSettlement(t.deps);
  await runSettlement(t.deps);
  expect(tokens(one.wallet)).toBe(USDC);
  expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(1);
  expect(books(study.id)).toMatchObject({ settledUnits: USDC, ok: true });
});

it('an unmatched deposit to a vault is alerted and never credited (R7)', async () => {
  const { study, vault } = await fundedStudy();
  expect((await runSettlement(t.deps)).alerts).toEqual([]);
  chain.recordFunding({ from: chain.keys.outsider, toAta: vault, amount: 4242, reference: 'x' });
  const { alerts } = await runSettlement(t.deps);
  expect(alerts).toEqual([expect.stringMatching(new RegExp(`unmatched deposit in the vault of study ${study.id}: 4242 units`))]);
  expect(books(study.id)).toMatchObject({ fundedUnits: 3_300_000, availableUnits: 3_300_000, ok: true });
});

it('a vault short of its books is alerted', async () => {
  const { study, vault } = await fundedStudy();
  chain.balances.set(vault, 3_000_000);
  const { alerts } = await runSettlement(t.deps);
  expect(alerts).toEqual([expect.stringMatching(new RegExp(`vault shortfall for study ${study.id}: 300000 units`))]);
});

it('funding from a wallet that is not the pilot builder key is refused before anything is created', async () => {
  const b = await t.register('builder');
  await t.linkWallet(b.token);
  const { rewardCredits: _, ...rest } = STUDY;
  const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots: 1, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
  const r = await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token);
  expect(r.status).toBe(403);
  expect(r.body.message).toMatch(/pilot builder test key/);
  expect(chain.sent).toEqual([]);
});

it('a wrong-mint funding transfer credits nothing (R8)', async () => {
  const b = await t.register('builder');
  await t.linkWallet(b.token, chain.seedOf('builder'));
  const { rewardCredits: _, ...rest } = STUDY;
  const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots: 1, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
  const f = (await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body;
  const sig = chain.recordFunding({ from: chain.keys.builder, toAta: f.vault, amount: f.amountUnits, reference: f.reference, mint: 'So11111111111111111111111111111111111111112' });
  const r = (await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: sig })).body;
  expect(r).toMatchObject({ status: 'failed' });
  expect(books(study.id)).toMatchObject({ fundedUnits: 0, ok: true });
});
