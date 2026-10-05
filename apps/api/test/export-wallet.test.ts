import { afterEach, describe, expect, it } from 'vitest';
import { ExportBundle, Study } from '@pocket-qa/contracts';
import { runSettlement } from '../src/settlement/worker';
import { DEVICE, makeApp, STUDY, type TestApp } from './helpers';

// Account export of the wallet-escrow and reputation data (release gap after pqa-qa r2):
// least data, own data only, token amounts as exact decimal strings of base units, and no
// provider-internal fields. A builder sees their studies' money, never a tester's wallet or email.
let t: TestApp;
afterEach(async () => t?.close());

const USDC = 1_000_000;
async function setup() {
  t = await makeApp({ settlement: 'simulated' });
  const b = await t.register('builder');
  const bw = await t.linkWallet(b.token);
  const { rewardCredits: _, ...rest } = STUDY;
  const s = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots: 2, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
  const f = (await t.req('POST', `/studies/${s.id}/escrow/fundings`, b.token)).body;
  const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
  await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature });
  await t.req('POST', `/studies/${s.id}/publish`, b.token);
  const testers = [];
  for (const helpful of [true, false]) {
    const u = await t.register('tester');
    await t.req('PUT', '/me/device', u.token, DEVICE);
    const w = await t.linkWallet(u.token);
    const p = (await t.req('POST', `/studies/${s.id}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: w.address })).body;
    await t.req('POST', `/participations/${p.id}/start`, u.token);
    await t.req('POST', `/participations/${p.id}/submit`, u.token);
    await t.req('POST', `/participations/${p.id}/approve`, b.token, { helpful });
    testers.push({ ...u, wallet: w.address, pid: p.id as string });
  }
  await runSettlement(t.deps);
  await t.req('PUT', '/me/leaderboard', testers[0]!.token, { optIn: true, alias: 'Export Ella' });
  return { b, bw, s, f, testers };
}
const exportOf = async (token: string) => {
  const r = await t.req('POST', '/me/export', token);
  expect(r.status).toBe(200);
  return { bundle: ExportBundle.parse(r.body), raw: JSON.stringify(r.body) };
};

describe('tester export', () => {
  it('has their own rewards (exact string units, their frozen wallet) and their reputation, nothing of others', async () => {
    const { testers, s } = await setup();
    const [ella, other] = testers;
    const { bundle, raw } = await exportOf(ella!.token);
    expect(bundle.payments.received).toEqual([
      expect.objectContaining({ participationId: ella!.pid, studyId: s.id, amountUnits: '1000000', asset: 'USDC', decimals: 6, destination: ella!.wallet, settlement: 'simulated', status: 'confirmed' }),
    ]);
    expect(bundle.payments.fundings).toEqual([]);
    expect(bundle.payments.studyPayments).toEqual([]);
    expect(bundle.reputation).toMatchObject({ points: 15, noCashValue: true, leaderboard: { optedIn: true, alias: 'Export Ella' } });
    expect(bundle.reputation.events.map((e) => e.kind).sort()).toEqual(['accepted', 'helpful']);
    expect(bundle.reputation.badges.map((x) => x.id)).toContain('first_accepted');
    // Nothing of the other tester, and no provider-internal fields.
    expect(raw).not.toContain(other!.wallet);
    expect(raw).not.toContain(other!.email);
    expect(raw).not.toContain(other!.pid);
    expect(raw).not.toMatch(/attempt_?key|idempotency|attempts?"/i);
    // Every token amount in the export is an exact string; the reward appears once.
    expect(raw).not.toMatch(/"(amountUnits|feeUnits)":\s*\d/);
    expect(bundle.participations.every((p) => p.payout === null)).toBe(true);
  });

  it('records its fraud finding and withheld-points flags on its own work', async () => {
    const { testers } = await setup();
    const a = await t.admin();
    await t.req('POST', `/admin/participations/${testers[1]!.pid}/fraud`, a.token, { reason: 'Duplicate clip from another tester.' });
    const { bundle } = await exportOf(testers[1]!.token);
    expect(bundle.reputation.fraudFindings).toEqual([expect.objectContaining({ participationId: testers[1]!.pid, reason: 'Duplicate clip from another tester.' })]);
    expect(bundle.reputation.points).toBe(0);
    expect(JSON.stringify(bundle.reputation.fraudFindings)).not.toContain(a.id); // the deciding admin isn't named
  });
});

describe('builder export', () => {
  // The builder's own findings keep the participation id they were written on (pre-existing,
  // the builder's own record); a tester's wallet, email and user id never appear.
  it('has their studies’ fundings, refunds and per-test payments, with no tester wallet, email or user id', async () => {
    const { b, bw, s, testers } = await setup();
    await t.req('POST', `/participations/${testers[0]!.pid}/findings`, b.token, { title: 'OTP confusing', severity: 'major', description: 'The code destination was unclear.' });
    await t.req('POST', `/studies/${s.id}/close`, b.token);
    await runSettlement(t.deps);
    const { bundle, raw } = await exportOf(b.token);
    expect(bundle.payments.fundings).toEqual([expect.objectContaining({ studyId: s.id, amountUnits: '2200000', source: bw.address, status: 'confirmed' })]);
    expect(bundle.payments.refunds).toEqual([]); // both slots were used: nothing left to refund
    expect(bundle.payments.studyPayments).toHaveLength(2);
    for (const p of bundle.payments.studyPayments) {
      expect(p).toEqual({ studyId: s.id, amountUnits: '1000000', feeUnits: '100000', status: 'confirmed', authorizedAt: expect.any(String), settledAt: expect.any(String) });
    }
    expect(bundle.payments.received).toEqual([]);
    expect(bundle.findings).toHaveLength(1);
    for (const u of testers) {
      expect(raw).not.toContain(u.wallet);
      expect(raw).not.toContain(u.email);
      expect(raw).not.toContain(u.id);
      // Money rows never carry a participation id.
      expect(JSON.stringify(bundle.payments)).not.toContain(u.pid);
    }
  });

  it('includes the refund to their funding wallet, and nothing of another builder', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const make = async () => {
      const b = await t.register('builder');
      const w = await t.linkWallet(b.token);
      const { rewardCredits: _, ...rest } = STUDY;
      const s = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots: 1, payment: { mode: 'escrow', rewardUnits: 333_333 } })).body);
      const f = (await t.req('POST', `/studies/${s.id}/escrow/fundings`, b.token)).body;
      const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
      await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature });
      await t.req('POST', `/studies/${s.id}/close`, b.token);
      return { b, w, s };
    };
    const one = await make();
    const two = await make();
    await runSettlement(t.deps);
    const { bundle, raw } = await exportOf(one.b.token);
    expect(bundle.payments.refunds).toEqual([expect.objectContaining({ studyId: one.s.id, amountUnits: '366667', destination: one.w.address, status: 'confirmed' })]);
    expect(raw).not.toContain(two.s.id);
    expect(raw).not.toContain(two.w.address);
  });
});

describe('every export', () => {
  it('a test-credit-only account gets empty payment and reputation sections (the shape is stable)', async () => {
    t = await makeApp();
    const u = await t.register('tester');
    const { bundle } = await exportOf(u.token);
    expect(bundle.payments).toEqual({ received: [], fundings: [], refunds: [], studyPayments: [] });
    expect(bundle.reputation).toMatchObject({ points: 0, events: [], badges: [], fraudFindings: [], withheldPoints: [], leaderboard: { optedIn: false, alias: null } });
  });
});
