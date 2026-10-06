import { afterEach, describe, expect, it } from 'vitest';
import { EscrowFunding, Payout, Study } from '@pocket-qa/contracts';
import { SimulatedSettlement } from '../src/settlement/simulated';
import { runSettlement } from '../src/settlement/worker';
import { DEVICE, makeApp, STUDY, type TestApp } from './helpers';

// The settlement job as a bounded, fenced slice (plan §5, R5) and the simulator persisting through
// the escrow repository (what hosted Firestore deployments run).
let t: TestApp;
afterEach(async () => t?.close());

const USDC = 1_000_000;

async function walletUser(role: 'builder' | 'tester') {
  const u = await t.register(role);
  if (role === 'tester') await t.req('PUT', '/me/device', u.token, DEVICE);
  const w = await t.linkWallet(u.token);
  return { ...u, wallet: w.address };
}

/** A funded escrow study with `n` approved participations (n pending payouts). */
async function approvedPayouts(n: number) {
  const b = await walletUser('builder');
  const { rewardCredits: _, ...rest } = STUDY;
  const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots: n, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
  const f = EscrowFunding.parse((await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body);
  const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
  expect((await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature })).body.status).toBe('confirmed');
  expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).status).toBe(200);
  const testers = [];
  for (let i = 0; i < n; i++) {
    const u = await walletUser('tester');
    const p = (await t.req('POST', `/studies/${study.id}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: u.wallet })).body;
    await t.req('POST', `/participations/${p.id}/start`, u.token);
    await t.req('POST', `/participations/${p.id}/submit`, u.token);
    expect((await t.req('POST', `/participations/${p.id}/approve`, b.token, {})).status).toBe(200);
    testers.push(u);
  }
  return testers;
}
const statuses = async (u: { token: string }) => (await t.req('GET', '/me/payouts', u.token)).body.items.map((x: unknown) => Payout.parse(x).status);

describe('runSettlement slices', () => {
  it('maxItems bounds a run; the next runs resume and finish (complete reported)', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const testers = await approvedPayouts(3);
    const first = await runSettlement(t.deps, { maxItems: 1 });
    expect(first.complete).toBe(false);
    expect(t.sim.payoutCount()).toBe(1);
    let last = first;
    for (let i = 0; i < 10 && !last.complete; i++) last = await runSettlement(t.deps, { maxItems: 2 });
    expect(last.complete).toBe(true);
    for (const u of testers) expect(await statuses(u)).toEqual(['confirmed']);
    expect(t.sim.payoutCount()).toBe(3); // resumed slices never send twice
  });

  it('a deadline already passed starts no item', async () => {
    t = await makeApp({ settlement: 'simulated' });
    await approvedPayouts(1);
    const r = await runSettlement(t.deps, { deadlineMs: t.clock.now });
    expect(r.complete).toBe(false);
    expect(t.sim.payoutCount()).toBe(0);
  });

  it('a fenced-out holder stops before its next item; the live holder finishes', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const [u] = await approvedPayouts(1);
    const stale = (await t.deps.repo.core.acquireLease('settle', 'a', 60_000, t.clock.now))!;
    t.clock.now += 61_000; // lease expired; another holder takes over with a higher fence
    const live = (await t.deps.repo.core.acquireLease('settle', 'b', 60_000, t.clock.now))!;
    expect(live).toBeGreaterThan(stale);
    const r = await runSettlement(t.deps, { lease: { job: 'settle', fence: stale } });
    expect(r.complete).toBe(false);
    expect(t.sim.payoutCount()).toBe(0);
    await runSettlement(t.deps, { lease: { job: 'settle', fence: live } });
    await runSettlement(t.deps, { lease: { job: 'settle', fence: live } });
    expect(await statuses(u!)).toEqual(['confirmed']);
  });
});

describe('SimulatedSettlement over the repository (hosted path)', () => {
  it('submit is idempotent per key, getTransfer and status read through the repo', async () => {
    t = await makeApp();
    const sim = new SimulatedSettlement(t.deps.repo, () => t.clock.now);
    const req = { key: 'set-1:1', kind: 'payout' as const, vault: 'sim-vault:s1', destination: 'w1', amountUnits: 5 };
    const a = await sim.submit(req);
    const b = await sim.submit(req);
    expect(b.signature).toBe(a.signature);
    expect(await sim.status(a.signature)).toBe('finalized');
    expect(await sim.getTransfer(a.signature)).toMatchObject({ destination: 'w1', amountUnits: 5, source: 'sim-vault:s1' });
    expect(() => sim.payoutCount()).toThrow(/SQLite/);
  });
});
