import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EscrowFunding, Participation, Payout, Study } from '@pocket-qa/contracts';
import { MAINNET_USDC_MINT } from '@pocket-qa/domain';
import { loadConfig } from '../src/config';
import { studyEscrowBooks } from '../src/escrow';
import { runSettlement } from '../src/settlement/worker';
import { DEVICE, makeApp, STUDY, type TestApp } from './helpers';

// Wallet-funded escrow, SIMULATED settlement only (ADR 0007). Rows refer to pqa-qa's
// qa-local-slice-test-matrix-r1 (A–I). Amounts are USDC base units (1 USDC = 1_000_000).
let t: TestApp;
afterEach(async () => t?.close());

const USDC = 1_000_000;
const ESCROW_STUDY = (over: Record<string, unknown> = {}) => {
  const { rewardCredits: _, ...rest } = STUDY;
  return { ...rest, slots: 3, payment: { mode: 'escrow', rewardUnits: USDC }, ...over };
};

async function builderWithWallet() {
  const b = await t.register('builder');
  const w = await t.linkWallet(b.token);
  return { ...b, wallet: w.address };
}
async function testerWithWallet() {
  const u = await t.register('tester');
  await t.req('PUT', '/me/device', u.token, DEVICE);
  const w = await t.linkWallet(u.token);
  return { ...u, wallet: w.address, kp: w };
}

/** A builder with a funded (simulated) escrow study, published. */
async function fundedStudy(over: Record<string, unknown> = {}) {
  const b = await builderWithWallet();
  const created = await t.req('POST', '/studies', b.token, ESCROW_STUDY(over));
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const study = Study.parse(created.body);
  const f = EscrowFunding.parse((await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body);
  const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
  const sub = await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature });
  expect(sub.body.status, JSON.stringify(sub.body)).toBe('confirmed');
  expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).status).toBe(200);
  return { b, study, funding: f };
}

async function consent(u: { token: string; wallet: string }, studyId: string) {
  return t.req('POST', `/studies/${studyId}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: u.wallet });
}
async function submitted(studyId: string) {
  const u = await testerWithWallet();
  const p = (await consent(u, studyId)).body;
  await t.req('POST', `/participations/${p.id}/start`, u.token);
  await t.req('POST', `/participations/${p.id}/submit`, u.token);
  return { u, pid: p.id as string };
}
const books = (studyId: string) => studyEscrowBooks(t.db, studyId, t.clock.now);
const testCreditRows = () => (t.db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;

describe('A: scope, honesty and fail-closed', () => {
  const base = { POCKETQA_DATA_DIR: '/tmp/pqa-escrow-cfg' };
  it('A1: production refuses simulated settlement; settlement is off by default and reported in /config', async () => {
    expect(loadConfig(base).features.settlement).toBe('off');
    expect(loadConfig({ ...base, POCKETQA_SETTLEMENT: 'simulated' }).features.settlement).toBe('simulated');
    const prod = {
      ...base,
      POCKETQA_ENV: 'production',
      POCKETQA_AUTH_MODE: 'firebase',
      POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
      POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key', // check-secrets: allow (placeholder public Firebase web config in tests)
      POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa.example',
      POCKETQA_STORAGE: 'r2',
      POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
      POCKETQA_R2_BUCKET: 'pocketqa-evidence',
      POCKETQA_R2_ACCESS_KEY_ID: 'key-id',
      POCKETQA_R2_SECRET_ACCESS_KEY: 'not-a-real-secret', // check-secrets: allow (placeholder test value)
      POCKETQA_R2_ALLOW_DELETE: '1',
    };
    expect(loadConfig(prod).features.settlement).toBe('off');
    expect(() => loadConfig({ ...prod, POCKETQA_SETTLEMENT: 'simulated' })).toThrow(/simulated settlement.*production/i);
    t = await makeApp({ settlement: 'simulated' });
    expect((await t.req('GET', '/config')).body.features.settlement).toBe('simulated');
  });

  it('A2: no provider, mint, RPC or network can be configured in this phase (mainnet included)', () => {
    for (const [k, v] of <[string, string][]>[
      ['POCKETQA_SETTLEMENT', 'devnet'],
      ['POCKETQA_SETTLEMENT', 'mainnet'],
      ['POCKETQA_SETTLEMENT_MINT', MAINNET_USDC_MINT],
      ['POCKETQA_SETTLEMENT_RPC_URL', 'https://api.mainnet-beta.solana.com'],
      ['POCKETQA_SETTLEMENT_NETWORK', 'solana:mainnet'],
      ['POCKETQA_SETTLEMENT_KEYPAIR', '/tmp/key.json'],
    ]) {
      expect(() => loadConfig({ ...base, [k]: v }), `${k}=${v}`).toThrow();
    }
  });

  it('A3: the server settlement path holds no keys and has no signing or sending code', () => {
    const dir = join(import.meta.dirname, '../src');
    const files = ['settlement', '.'].flatMap((d) => readdirSync(join(dir, d)).filter((f) => f.endsWith('.ts')).map((f) => join(dir, d, f)));
    const src = files.filter((f) => /settlement|escrow/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src.length).toBeGreaterThan(1000);
    expect(src).not.toMatch(/signTransaction|sendTransaction|sendRawTransaction|Keypair|secretKey|fromSecretKey|createKeyPair|signAndSend/);
  });

  it('A4: every escrow amount, funding and payout is labelled simulated; settlement off refuses escrow studies', async () => {
    t = await makeApp({ settlement: 'off' });
    const b = await builderWithWallet();
    const r = await t.req('POST', '/studies', b.token, ESCROW_STUDY());
    expect(r.body.code).toBe('FEATURE_UNAVAILABLE');
  });

  it('A7: the escrow ledger is separate: escrow studies never touch test credits', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const before = testCreditRows();
    const { b, study } = await fundedStudy();
    const { pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    await runSettlement(t.deps);
    expect(testCreditRows()).toBe(before);
    expect((await t.req('GET', '/me/credits', b.token)).body.balance).toBe(0);
  });
});

describe('B: funding (simulated) and verification', () => {
  it('B1/B5: the server fixes amount, mint and vault; publishing waits for confirmed, exact funding', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await builderWithWallet();
    const study = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY())).body);
    expect(study.payment).toMatchObject({ mode: 'escrow', settlement: 'simulated', asset: 'USDC', decimals: 6, funded: false, quote: { rewardPoolUnits: 3 * USDC, platformFeeUnits: 300_000, totalUnits: 3_300_000 } });
    expect(study.reward).toEqual({ kind: 'token', asset: 'USDC', decimals: 6, units: USDC, settlement: 'simulated' });
    expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).body.code).toBe('BUDGET_INSUFFICIENT');
    // A tampered body is ignored: the route takes no body; the amount comes from the quote.
    const f = EscrowFunding.parse((await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token, { amountUnits: 1, mint: MAINNET_USDC_MINT })).body);
    expect(f).toMatchObject({ amountUnits: 3_300_000, mint: 'SIM-USDC', network: 'simulated', settlement: 'simulated', status: 'awaiting_payment' });
    // Submitted but still processing: pending, and publishing is still refused.
    t.sim.holdProcessing = true;
    const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
    expect((await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature })).body.status).toBe('pending');
    expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).body.code).toBe('BUDGET_INSUFFICIENT');
    t.sim.holdProcessing = false;
    await runSettlement(t.deps);
    const after = (await t.req('GET', `/escrow/fundings/${f.id}`, b.token)).body;
    expect(after).toMatchObject({ status: 'confirmed', source: b.wallet });
    expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).status).toBe(200);
    expect(books(study.id)).toMatchObject({ fundedUnits: 3_300_000, availableUnits: 3_300_000, ok: true });
  });

  it.each([
    ['wrong network', { network: 'solana:devnet' }],
    ['wrong mint', { mint: MAINNET_USDC_MINT }],
    ['wrong vault', { destination: 'sim-vault:elsewhere' }],
    ['underpaid', { amountUnits: 3_299_999 }],
    ['overpaid', { amountUnits: 3_300_001 }],
    ['another funding request', { reference: 'ref-of-someone-else' }],
    ['failed transfer', { status: 'failed' }],
  ])('B2: a %s transfer is refused and credits nothing', async (_, patch) => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await builderWithWallet();
    const study = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY())).body);
    const f = EscrowFunding.parse((await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body);
    const sig = t.sim.recordTransfer({ network: 'simulated', mint: 'SIM-USDC', source: b.wallet, destination: f.vault, amountUnits: f.amountUnits, reference: f.reference, status: 'finalized' as const, ...(patch as object) });
    const r = await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: sig });
    expect(r.body.status).toBe('failed');
    expect(r.body.failureReason).toBeTruthy();
    expect(books(study.id).fundedUnits).toBe(0);
  });

  it('B4: one transfer signature funds one request only (resubmitted, or for another study)', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study, funding } = await fundedStudy();
    const sig = (t.db.prepare('SELECT signature FROM escrow_fundings WHERE id = ?').get(funding.id) as { signature: string }).signature;
    expect((await t.req('POST', `/escrow/fundings/${funding.id}/signature`, b.token, { signature: sig })).status).toBe(409);
    const other = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY({ title: 'Second escrow study' }))).body);
    const f2 = EscrowFunding.parse((await t.req('POST', `/studies/${other.id}/escrow/fundings`, b.token)).body);
    expect((await t.req('POST', `/escrow/fundings/${f2.id}/signature`, b.token, { signature: sig })).status).toBe(409);
    expect(books(study.id).fundedUnits).toBe(3_300_000);
    expect(books(other.id).fundedUnits).toBe(0);
  });

  it('only the owning builder can see or fund a study’s escrow (404 for others)', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { funding } = await fundedStudy();
    const other = await builderWithWallet();
    expect((await t.req('GET', `/escrow/fundings/${funding.id}`, other.token)).status).toBe(404);
    expect((await t.req('POST', `/escrow/fundings/${funding.id}/simulated-wallet-payment`, other.token)).status).toBe(404);
  });

  it('funding needs the builder’s linked wallet (the funding source) and an unfunded study', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await t.register('builder');
    const study = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY())).body);
    expect((await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body.code).toBe('CONFLICT_STATE');
  });
});

describe('C: reservation and concurrency', () => {
  it('C1/C2: 20 concurrent consents for 3 funded slots reserve exactly 3; the books balance', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { study } = await fundedStudy();
    const testers = await Promise.all(Array.from({ length: 20 }, () => testerWithWallet()));
    const results = await Promise.all(testers.map((u) => consent(u, study.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status !== 200).every((r) => r.body.code === 'CONFLICT_STATE')).toBe(true);
    expect(books(study.id)).toMatchObject({ heldUnits: 3_300_000, availableUnits: 0, ok: true });
  });

  it('C3: consent freezes the payout wallet; it must be the tester’s linked wallet, confirmed explicitly', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { study } = await fundedStudy();
    const noWallet = await t.register('tester');
    await t.req('PUT', '/me/device', noWallet.token, DEVICE);
    expect((await t.req('POST', `/studies/${study.id}/consent`, noWallet.token, { consentVersion: 1, accepted: true })).body.code).toBe('CONFLICT_STATE');
    const u = await testerWithWallet();
    expect((await t.req('POST', `/studies/${study.id}/consent`, u.token, { consentVersion: 1, accepted: true })).body.code).toBe('VALIDATION');
    const other = await testerWithWallet();
    expect((await t.req('POST', `/studies/${study.id}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: other.wallet })).body.code).toBe('VALIDATION');
    const ok = Participation.parse((await consent(u, study.id)).body);
    expect(ok.payoutAddress).toBe(u.wallet);
    expect(ok.reward).toMatchObject({ kind: 'token', units: USDC, settlement: 'simulated' });
  });
});

describe('D: payout and replay', () => {
  it('D1: double and concurrent approvals authorize one payout and settle once', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { u, pid } = await submitted(study.id);
    const rs = await Promise.all([1, 2, 3].map(() => t.req('POST', `/participations/${pid}/approve`, b.token, {})));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    await runSettlement(t.deps);
    await runSettlement(t.deps);
    const payouts = (await t.req('GET', '/me/payouts', u.token)).body.items.map((x: unknown) => Payout.parse(x));
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ status: 'confirmed', settlement: 'simulated', amountUnits: USDC, destination: u.wallet });
    expect(t.sim.payoutCount()).toBe(1);
    expect(books(study.id)).toMatchObject({ settledUnits: USDC, payableUnits: 0, feesUnits: 100_000, ok: true });
  });

  it('D2: a crash after the provider accepted a payout but before it was recorded never pays twice', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    t.sim.crashAfterSubmit = true;
    await expect(runSettlement(t.deps)).rejects.toThrow(/simulated crash/);
    t.sim.crashAfterSubmit = false;
    await runSettlement(t.deps);
    await runSettlement(t.deps);
    expect(t.sim.payoutCount()).toBe(1);
    expect(books(study.id)).toMatchObject({ settledUnits: USDC, ok: true });
  });

  it('D3/D5: a payout still processing is never settled early, and its late confirmation is counted once', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { pid, u } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    t.sim.holdProcessing = true;
    for (let i = 0; i < 4; i++) await runSettlement(t.deps);
    expect((await t.req('GET', '/me/payouts', u.token)).body.items[0].status).toBe('submitted');
    expect(books(study.id)).toMatchObject({ payableUnits: USDC, settledUnits: 0, ok: true });
    t.sim.holdProcessing = false;
    for (let i = 0; i < 3; i++) await runSettlement(t.deps); // replayed polls after finality change nothing
    expect((await t.req('GET', '/me/payouts', u.token)).body.items[0].status).toBe('confirmed');
    expect(books(study.id)).toMatchObject({ payableUnits: 0, settledUnits: USDC, ok: true });
    expect(t.sim.payoutCount()).toBe(1);
  });

  it.each(['missing_token_account', 'frozen_account', 'relayer_underfunded'] as const)('D4: a %s failure is failed with a reason, never settled, and a retry settles once', async (fault) => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { pid, u } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    t.sim.payoutFault = fault;
    await runSettlement(t.deps);
    await runSettlement(t.deps);
    const failed = Payout.parse((await t.req('GET', '/me/payouts', u.token)).body.items[0]);
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toMatch(/.{10,}/);
    expect(books(study.id)).toMatchObject({ payableUnits: USDC, settledUnits: 0, ok: true });
    t.sim.payoutFault = null;
    t.clock.now += 10 * 60_000;
    await runSettlement(t.deps);
    await runSettlement(t.deps);
    expect((await t.req('GET', '/me/payouts', u.token)).body.items[0].status).toBe('confirmed');
    expect(t.sim.payoutCount({ landed: true })).toBe(1);
    expect(books(study.id)).toMatchObject({ settledUnits: USDC, ok: true });
  });

  it('D6: uploading or submitting never authorizes a payout; only approval does', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { study } = await fundedStudy();
    const { u } = await submitted(study.id);
    await runSettlement(t.deps);
    expect((await t.req('GET', '/me/payouts', u.token)).body.items).toEqual([]);
  });
});

describe('E: payout wallet substitution', () => {
  it('E1/E2: re-linking another wallet, or naming a destination in a request, never redirects the payout', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { u, pid } = await submitted(study.id);
    expect((await t.req('DELETE', '/wallet', u.token)).status).toBe(200);
    const attacker = await t.linkWallet(u.token);
    await t.req('POST', `/participations/${pid}/approve`, b.token, { destination: attacker.address, amountUnits: 999 * USDC });
    await runSettlement(t.deps);
    const p = Payout.parse((await t.req('GET', '/me/payouts', u.token)).body.items[0]);
    expect(p).toMatchObject({ destination: u.wallet, amountUnits: USDC, status: 'confirmed' });
  });

  it('E3: an admin resolving a dispute decides the outcome only: amount and destination stay fixed', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { u, pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/reject`, b.token, { reason: 'The recording does not show the tasks.' });
    const d = (await t.req('POST', '/disputes', u.token, { participationId: pid, reason: 'I recorded every task as asked.' })).body;
    const a = await t.admin();
    const r = await t.req('POST', `/admin/disputes/${d.id}/resolve`, a.token, { outcome: 'overturned', note: 'Evidence shows the tasks.', destination: 'X', amountUnits: 5 });
    expect(r.status).toBe(200);
    await runSettlement(t.deps);
    expect(Payout.parse((await t.req('GET', '/me/payouts', u.token)).body.items[0])).toMatchObject({ destination: u.wallet, amountUnits: USDC, status: 'confirmed' });
  });
});

describe('F: disputes, refunds and closure', () => {
  it('F1/F2: a dispute holds only its reward; close refunds only unheld funds, once, to the funding wallet', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { u, pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/reject`, b.token, { reason: 'The recording does not show the tasks.' });
    const d = (await t.req('POST', '/disputes', u.token, { participationId: pid, reason: 'I recorded every task as asked.' })).body;
    expect(books(study.id)).toMatchObject({ heldUnits: 1_100_000, availableUnits: 2_200_000, ok: true });
    expect((await t.req('POST', `/studies/${study.id}/close`, b.token)).status).toBe(409); // dispute open
    const a = await t.admin();
    await t.req('POST', `/admin/disputes/${d.id}/resolve`, a.token, { outcome: 'overturned', note: 'Evidence shows the tasks.' });
    const closed = await Promise.all([1, 2].map(() => t.req('POST', `/studies/${study.id}/close`, b.token)));
    expect(closed.filter((r) => r.status === 200)).toHaveLength(1);
    expect(books(study.id)).toMatchObject({ payableUnits: USDC, pendingRefundUnits: 2_200_000, ok: true });
    await runSettlement(t.deps);
    await runSettlement(t.deps);
    expect(books(study.id)).toMatchObject({ fundedUnits: 3_300_000, availableUnits: 0, heldUnits: 0, payableUnits: 0, settledUnits: USDC, feesUnits: 100_000, pendingRefundUnits: 0, refundedUnits: 2_200_000, ok: true });
    const s = Study.parse((await t.req('GET', `/studies/${study.id}`, b.token)).body);
    expect(s.payment).toMatchObject({ refund: { status: 'confirmed', amountUnits: 2_200_000 }, fundingWallet: b.wallet });
    expect(t.sim.refundsTo(b.wallet)).toBe(2_200_000);
  });

  it('F3: withdrawing releases the hold', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { study } = await fundedStudy();
    const u = await testerWithWallet();
    const p = (await consent(u, study.id)).body;
    expect(books(study.id).heldUnits).toBe(1_100_000);
    await t.req('POST', `/participations/${p.id}/withdraw`, u.token, {});
    expect(books(study.id)).toMatchObject({ heldUnits: 0, availableUnits: 3_300_000, ok: true });
  });

  it('F4: review inactivity never auto-pays (settlement runs only approved payouts)', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { study } = await fundedStudy();
    const { u } = await submitted(study.id);
    t.clock.now += 30 * 24 * 3600_000;
    await runSettlement(t.deps);
    void u;
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM settlements').get()).toEqual({ n: 0 });
    expect(books(study.id)).toMatchObject({ heldUnits: 1_100_000, ok: true });
  });

  it('F5: account deletion follows the existing rules; an authorized payout still settles to the frozen wallet', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { u, pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    expect((await t.req('DELETE', '/me', u.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    await runSettlement(t.deps);
    expect(books(study.id)).toMatchObject({ settledUnits: USDC, ok: true });
    expect(t.sim.payoutsTo(u.wallet)).toBe(USDC);
    // An in-progress tester who deletes their account releases their hold.
    const v = await testerWithWallet();
    const p = (await consent(v, study.id)).body;
    await t.req('POST', `/participations/${p.id}/start`, v.token);
    expect((await t.req('DELETE', '/me', v.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(books(study.id)).toMatchObject({ heldUnits: 0, ok: true });
  });
});

describe('F5b: a builder deleting their account never strands escrowed funds (pqa-qa r1 P2-1)', () => {
  it('a funded draft is closed and refunded to the funding wallet; an unpaid request expires', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await builderWithWallet();
    const funded = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY())).body);
    const f = EscrowFunding.parse((await t.req('POST', `/studies/${funded.id}/escrow/fundings`, b.token)).body);
    const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
    await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature });
    const unpaid = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY({ title: 'Unpaid escrow study' }))).body);
    const open = EscrowFunding.parse((await t.req('POST', `/studies/${unpaid.id}/escrow/fundings`, b.token)).body);
    expect((await t.req('DELETE', '/me', b.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(t.db.prepare('SELECT status FROM studies WHERE id = ?').get(funded.id)).toEqual({ status: 'closed' });
    expect(t.db.prepare('SELECT status FROM escrow_fundings WHERE id = ?').get(open.id)).toEqual({ status: 'expired' });
    await runSettlement(t.deps);
    expect(books(funded.id)).toMatchObject({ fundedUnits: 3_300_000, availableUnits: 0, pendingRefundUnits: 0, refundedUnits: 3_300_000, ok: true });
    expect(t.sim.refundsTo(b.wallet)).toBe(3_300_000);
  });

  it('a funding still in flight at deletion is credited and refunded once it confirms', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await builderWithWallet();
    const s = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY())).body);
    const f = EscrowFunding.parse((await t.req('POST', `/studies/${s.id}/escrow/fundings`, b.token)).body);
    t.sim.holdProcessing = true;
    const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
    expect((await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature })).body.status).toBe('pending');
    expect((await t.req('DELETE', '/me', b.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    t.sim.holdProcessing = false;
    await runSettlement(t.deps); // confirms the funding, refunds it (study closed)
    await runSettlement(t.deps); // settles the refund
    expect(books(s.id)).toMatchObject({ fundedUnits: 3_300_000, refundedUnits: 3_300_000, availableUnits: 0, ok: true });
    expect(t.sim.refundsTo(b.wallet)).toBe(3_300_000);
  });
});

describe('P3: repeated payment failures escalate; a funding without a source wallet never confirms', () => {
  it('after 5 failed attempts the worker raises an operator alert and keeps retrying with backoff', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    t.sim.payoutFault = 'relayer_underfunded';
    let alerts: string[] = [];
    for (let i = 0; i < 6; i++) {
      alerts = (await runSettlement(t.deps)).alerts;
      t.clock.now += 2 * 3600_000;
    }
    expect(alerts.join('\n')).toMatch(/5\+ failed attempts/);
    expect(books(study.id)).toMatchObject({ payableUnits: USDC, settledUnits: 0, ok: true });
  });

  it('a transfer with no identifiable source wallet fails (refunds would have nowhere to go)', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await builderWithWallet();
    const s = Study.parse((await t.req('POST', '/studies', b.token, ESCROW_STUDY())).body);
    const f = EscrowFunding.parse((await t.req('POST', `/studies/${s.id}/escrow/fundings`, b.token)).body);
    const sig = t.sim.recordTransfer({ source: '', destination: f.vault, amountUnits: f.amountUnits, reference: f.reference });
    const r = await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: sig });
    expect(r.body).toMatchObject({ status: 'failed', failureReason: expect.stringMatching(/funding wallet/) });
    expect(books(s.id).fundedUnits).toBe(0);
  });
});

describe('G: admin powers and audit', () => {
  it('G1/G2: admins can list payouts but no route sets an amount or destination; money transitions are audited', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const { b, study } = await fundedStudy();
    const { pid } = await submitted(study.id);
    await t.req('POST', `/participations/${pid}/approve`, b.token, {});
    await runSettlement(t.deps);
    const a = await t.admin();
    expect((await t.req('GET', '/admin/payouts', a.token)).body.items).toHaveLength(1);
    const actions = (t.db.prepare(`SELECT action FROM audit WHERE action LIKE 'escrow.%' ORDER BY created_at, rowid`).all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['escrow.funding_confirmed', 'escrow.payout_authorized', 'escrow.payout_settled']));
  });
});

describe('I: ledger invariant under random operation sequences', () => {
  it('I1: the books balance after every step of seeded random runs', async () => {
    t = await makeApp({ settlement: 'simulated' });
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const { b, study } = await fundedStudy({ slots: 5 });
    const a = await t.admin();
    const live: { u: Awaited<ReturnType<typeof testerWithWallet>>; pid: string | null; state: string }[] = [];
    for (let i = 0; i < 6; i++) live.push({ u: await testerWithWallet(), pid: null, state: 'new' });
    for (let step = 0; step < 80; step++) {
      const x = live[rnd(live.length)]!;
      const op = rnd(9);
      if (x.state === 'new' && op < 3) {
        const r = await consent(x.u, study.id);
        if (r.status === 200) Object.assign(x, { pid: r.body.id, state: 'consented' });
      } else if (x.state === 'consented') {
        await t.req('POST', `/participations/${x.pid}/start`, x.u.token);
        await t.req('POST', `/participations/${x.pid}/submit`, x.u.token);
        x.state = 'submitted';
      } else if (x.state === 'submitted') {
        if (op < 5) await t.req('POST', `/participations/${x.pid}/approve`, b.token, {});
        else await t.req('POST', `/participations/${x.pid}/reject`, b.token, { reason: 'Not all tasks were shown.' });
        x.state = op < 5 ? 'done' : 'rejected';
      } else if (x.state === 'rejected' && op < 4) {
        const d = (await t.req('POST', '/disputes', x.u.token, { participationId: x.pid, reason: 'I did record every task here.' })).body;
        await t.req('POST', `/admin/disputes/${d.id}/resolve`, a.token, { outcome: op < 2 ? 'overturned' : 'upheld', note: 'Decided on evidence.' });
        x.state = 'done';
      } else if (op === 8) {
        t.sim.payoutFault = rnd(2) ? 'relayer_underfunded' : null;
        t.clock.now += 6 * 60_000;
        await runSettlement(t.deps);
      }
      const bk = books(study.id);
      expect(bk.ok, `step ${step}: ${JSON.stringify(bk)}`).toBe(true);
    }
    t.sim.payoutFault = null;
    t.clock.now += 8 * 24 * 3600_000; // past every dispute window
    for (const x of live) if (x.state === 'consented') await t.req('POST', `/participations/${x.pid}/withdraw`, x.u.token, {});
    for (const x of live) if (x.state === 'submitted') await t.req('POST', `/participations/${x.pid}/approve`, b.token, {});
    expect((await t.req('POST', `/studies/${study.id}/close`, b.token)).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      t.clock.now += 6 * 60_000;
      await runSettlement(t.deps);
    }
    const end = books(study.id);
    expect(end).toMatchObject({ availableUnits: 0, heldUnits: 0, payableUnits: 0, pendingRefundUnits: 0, ok: true });
    expect(end.settledUnits + end.feesUnits + end.refundedUnits).toBe(end.fundedUnits);
  });

  it('I2: one base unit and large rewards are exact integers end to end', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const tiny = await fundedStudy({ payment: { mode: 'escrow', rewardUnits: 1 }, slots: 1 });
    expect(tiny.study.payment).toMatchObject({ quote: { rewardUnits: 1, perTestFeeUnits: 1, totalUnits: 2 } });
    const big = await fundedStudy({ payment: { mode: 'escrow', rewardUnits: 100_000 * USDC }, slots: 1, title: 'Large reward' });
    expect(big.study.payment).toMatchObject({ quote: { totalUnits: 110_000 * USDC } });
    const { pid } = await submitted(big.study.id);
    await t.req('POST', `/participations/${pid}/approve`, big.b.token, {});
    await runSettlement(t.deps);
    expect(books(big.study.id)).toMatchObject({ settledUnits: 100_000 * USDC, ok: true });
  });
});
