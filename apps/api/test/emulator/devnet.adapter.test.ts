import { Keypair } from '@solana/web3.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAINNET_USDC_MINT } from '@pocket-qa/domain';
import { devnetFirestore } from '../../src/firestore/namespace';
import { runTxCtx } from '../../src/firestore/tx';
import { makeRepos } from '../../src/repo';
import { authorizePayoutInTx, createEscrowInTx } from '../../src/repo/escrow/firestore';
import { ataOf } from '../../src/settlement/squads/adapter';
import { devnetSettlement, type DevnetSquadsSettlement } from '../../src/settlement/squads/devnet';
import { DEFAULT_DEVNET_LIMITS, paymentLamports, type DevnetLimits } from '../../src/settlement/squads/devnetTypes';
import { MAINNET_GENESIS, PILOT_DECIMALS, PILOT_MINT, PILOT_TOKEN_PROGRAM } from '../../src/settlement/squads/pins';
import { SettlementFailure, SettlementPending } from '../../src/settlement/types';
import { runSettlement } from '../../src/settlement/worker';
import type { ParticipationRow, StudyRow } from '../../src/views/studies';
import { FakeDevnetChain } from '../fakeDevnetChain';
import { clearEmulator, emulatorFirestore } from './fs';

// The devnet adapter on Firestore (devnet namespace) over the fake chain: pqa-qa P2-DA1/DA2,
// CH-D1/D3/D5, pqa-be2 flags 1-3 and P2 (whole-payment reservation), and the custody order
// (the cosigner votes first; the platform signer only completes the 2-of-3).
const raw = emulatorFirestore();
const fs = devnetFirestore(raw);
const NOW0 = 1_800_000_000_000;
let now = NOW0;
const ISO = new Date(NOW0).toISOString();
const BUILDER_EMAIL = 'devnet-builder@example.test';
const feeWallet = Keypair.generate().publicKey.toBase58();

let chain: FakeDevnetChain;
let builder: Keypair;
let repos: ReturnType<typeof makeRepos>;
let adapter: DevnetSquadsSettlement;

function make(limits: DevnetLimits = DEFAULT_DEVNET_LIMITS, roles?: { platform: string; arbiter: string; feeWallet: string }) {
  return devnetSettlement({ repo: repos, chain, now: () => now, limits, roles: roles ?? { platform: chain.roles.platform, arbiter: chain.roles.arbiter, feeWallet }, allowedEmails: [BUILDER_EMAIL] });
}

const study = (over: Partial<StudyRow> = {}): StudyRow => ({
  id: 's1', builder_id: 'b1', title: 'Devnet study', objective: 'o', build_under_test: null, device_criteria_json: '{}', reward_credits: 1_000,
  payment_mode: 'escrow', slots: 30, consent_text: 'c', consent_version: 1, status: 'published', moderation: 'ok', created_at: ISO, published_at: ISO, closed_at: null, ...over,
});
const part = (id: string): ParticipationRow => ({
  id, study_id: 's1', tester_id: `t-${id}`, status: 'approved', consent_version: 1, consented_at: ISO, started_at: null, submitted_at: null,
  decided_at: ISO, decided_by: 'b1', decision_reason: null, reward_credits: 1_000, payout_address: Keypair.generate().publicKey.toBase58(),
});

beforeEach(async () => {
  await clearEmulator();
  now = NOW0;
  chain = new FakeDevnetChain();
  builder = Keypair.generate();
  repos = makeRepos({ kind: 'firestore', fs: raw, namespace: 'devnet' });
  adapter = make();
  await repos.core.createUser({ id: 'b1', email: BUILDER_EMAIL, password_hash: null, display_name: 'Devnet builder', role: 'builder', status: 'active', device_json: null, created_at: ISO });
  await fs.collection('studies').doc('s1').set(study());
});

/** Calls `f` until it stops being pending (each call sends at most one transaction). */
async function untilDone<T>(f: () => Promise<T>, max = 12): Promise<T> {
  for (let i = 0; i < max; i++) {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof SettlementPending)) throw e;
    }
  }
  throw new Error('still pending');
}

/** A ready vault holding `units`, with the escrow books funded to match. */
async function readyVault(units = 100_000) {
  await untilDone(() => adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' }));
  await runTxCtx(raw, (t) => createEscrowInTx(t, fs, { study_id: 's1', builder_id: 'b1', settlement: 'squads_devnet', network: 'solana:devnet', mint: PILOT_MINT, vault: adapter.vaultFor('s1'), fee_bps: 0, created_at: ISO }));
  await fs.collection('studyEscrows').doc('s1').update({ funding_wallet: builder.publicKey.toBase58() });
  await fs.collection('escrowBooks').doc('s1').set({ accounts: { 'in:funding': -units, 'vault:s1': units } });
  chain.fundVault(adapter.vaultFor('s1'), units);
}

/** n approved payouts (settlement rows), each 1,000 units to its own tester wallet. */
async function payouts(n: number) {
  const ps = Array.from({ length: n }, (_, i) => part(`p${i}`));
  for (const p of ps) {
    await fs.collection('participations').doc(p.id).set(p);
    await runTxCtx(raw, (t) => authorizePayoutInTx(t, fs, study(), p, 0, now, 'b1', 'approved', 'builder'));
  }
  return ps;
}
const settle = (a = adapter) => runSettlement({ repo: repos, now: () => now, settlement: a });
const statusOf = async (pid: string) => (await repos.escrow.payoutSettlementOf(pid))!.status;
const approveAsBuilder = async (pid: string) => {
  const s = (await repos.escrow.payoutSettlementOf(pid))!;
  const a = await adapter.approval(s, builder.publicKey.toBase58());
  return { s, a, signature: chain.walletSend(a.transactionB64, builder.publicKey.toBase58()) };
};

describe('custody order: the cosigner votes first, the platform only completes the 2-of-3', () => {
  it('a payout end to end: vault, receipt, proposal, WAIT for the builder, then platform vote + execute', async () => {
    await readyVault();
    const [p] = await payouts(1);
    for (let i = 0; i < 6; i++) await settle();
    expect(await statusOf(p!.id)).toBe('awaiting_approval');
    expect(chain.prepared.map((x) => x.step)).not.toContain('approve_platform'); // nothing the server could vote alone
    const { s, a, signature } = await approveAsBuilder(p!.id);
    expect(a).toMatchObject({ network: 'devnet', kind: 'payout', amountUnits: 1_000, destination: p!.payout_address, txIndex: 1 });
    expect(await adapter.submitApproval(s, { signature, txIndex: a.txIndex, opId: a.opId }, builder.publicKey.toBase58())).toMatchObject({ status: 'submitted', network: 'devnet' });
    for (let i = 0; i < 6; i++) await settle();
    expect(await statusOf(p!.id)).toBe('confirmed');
    expect(chain.landed.filter((l) => l.step === 'execute')).toHaveLength(1);
    expect(chain.balances.get(ataOf(p!.payout_address!))).toBe(1_000);
    const steps = chain.landed.map((l) => l.step);
    expect(steps.indexOf('cosigner_approve')).toBeLessThan(steps.indexOf('approve_platform'));
  });
});

describe('pins before EVERY signature (pqa-qa P2-DA2): 0 signatures on a wrong cluster or mint', () => {
  const bad: [string, (c: FakeDevnetChain) => void][] = [
    ['the mainnet genesis', (c) => (c.genesis = MAINNET_GENESIS)],
    ['the mainnet USDC mint account', (c) => (c.mintAccount = { address: MAINNET_USDC_MINT, owner: PILOT_TOKEN_PROGRAM, decimals: PILOT_DECIMALS })],
    ['a mint owned by another program', (c) => (c.mintAccount = { address: PILOT_MINT, owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', decimals: PILOT_DECIMALS })],
    ['wrong decimals', (c) => (c.mintAccount = { address: PILOT_MINT, owner: PILOT_TOKEN_PROGRAM, decimals: 9 })],
    ['no mint account', (c) => (c.mintAccount = null)],
    ['the Squads program not as pinned', (c) => (c.programOk = false)],
  ];
  for (const [name, breakIt] of bad) {
    it(`${name}: the vault is never created and no payment step is signed`, async () => {
      breakIt(chain);
      await expect(adapter.startupCheck()).rejects.toBeInstanceOf(SettlementFailure);
      await expect(adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' })).rejects.toBeInstanceOf(SettlementFailure);
      expect(chain.prepared).toEqual([]);
    });
    it(`${name}, mid-payment: the next step is refused before signing`, async () => {
      await readyVault();
      const [p] = await payouts(1);
      await settle(); // one step sent
      const signed = chain.prepared.length;
      breakIt(chain);
      for (let i = 0; i < 4; i++) await settle();
      expect(chain.prepared.length).toBe(signed);
      expect(await statusOf(p!.id)).toBe('failed');
    });
  }
});

describe('the platform key (pqa-qa P2-DA1)', () => {
  it('refuses when the loaded signer is not the pinned key: 0 signatures', async () => {
    adapter = make(DEFAULT_DEVNET_LIMITS, { platform: Keypair.generate().publicKey.toBase58(), arbiter: chain.roles.arbiter, feeWallet });
    await expect(adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' })).rejects.toThrow(/POCKETQA_DEVNET_PLATFORM_PUBKEY/);
    expect(chain.prepared).toEqual([]);
  });
  it('refuses a builder wallet equal to the platform key (a server-held second vote): 0 signatures', async () => {
    await expect(adapter.prepareVault({ studyId: 's1', builderWallet: chain.roles.platform, userId: 'b1' })).rejects.toThrow(/another role/);
    expect(chain.prepared).toEqual([]);
  });
  it('refuses a builder who is not on the synthetic allow-list (CH-D1)', async () => {
    await repos.core.createUser({ id: 'b2', email: 'someone-else@example.test', password_hash: null, display_name: 'x', role: 'builder', status: 'active', device_json: null, created_at: ISO });
    await expect(adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b2' })).rejects.toThrow(/allow|synthetic/);
    expect(chain.prepared).toEqual([]);
  });
});

describe('receipts and broadcasts (CH-D5, pqa-be2 flags 1 and 3)', () => {
  it('every broadcast finds its message, wire bytes and signature already in the receipt', async () => {
    let checked = 0;
    chain.onBroadcast = async (p) => {
      const docs = [...(await repos.escrow.devnet!.vault('s1').then((v) => (v ? [v] : []))), ...(await fs.collection('squadsAttempts').get()).docs.map((d) => d.data())];
      const rec = docs.map((d) => (d as { steps: Record<string, { signature: string; message_b64: string; wire_b64: string }> }).steps[p.step]).find((s) => s?.signature === p.signature);
      expect(rec, p.step).toMatchObject({ signature: p.signature, message_b64: p.messageB64, wire_b64: p.wireB64 });
      checked += 1;
    };
    await readyVault();
    const [p] = await payouts(1);
    for (let i = 0; i < 6; i++) await settle();
    await approveAsBuilder(p!.id);
    for (let i = 0; i < 6; i++) await settle();
    expect(await statusOf(p!.id)).toBe('confirmed');
    expect(checked).toBe(chain.landed.filter((l) => l.step !== 'cosigner_approve').length);
  });

  it('a crash right after execute landed: the retry adopts it (one execute, no second transfer)', async () => {
    await readyVault();
    const [p] = await payouts(1);
    for (let i = 0; i < 6; i++) await settle();
    await approveAsBuilder(p!.id);
    chain.crashAfter = 'execute';
    let crashed = false;
    for (let i = 0; i < 8; i++) await settle().catch(() => (crashed = true));
    expect(crashed).toBe(true);
    expect(await statusOf(p!.id)).toBe('confirmed');
    expect(chain.landed.filter((l) => l.step === 'execute')).toHaveLength(1);
    expect(chain.prepared.filter((l) => l.step === 'execute')).toHaveLength(1);
  });

  it('an unlanded broadcast: same bytes again while lastValidBlockHeight >= height (equal included), rebuilt only when strictly expired', async () => {
    chain.dropNext = 1;
    const go = () => adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' }).catch((e) => e);
    await go();
    const first = chain.prepared[0]!;
    const v = (await repos.escrow.devnet!.vault('s1'))!;
    chain.height = v.steps.multisig_create!.last_valid_block_height; // equal: can still land
    chain.dropNext = 1;
    await go();
    expect(chain.prepared).toHaveLength(1); // not rebuilt
    expect(chain.broadcasts.filter((b) => b.signature === first.signature)).toHaveLength(2);
    chain.height += 1; // strictly expired, and the multisig is absent on chain
    await go();
    expect(chain.prepared).toHaveLength(2);
    await untilDone(() => adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' }));
    expect(chain.landed.filter((l) => l.step === 'multisig_create')).toHaveLength(1);
  });

  it('a holder fenced out after a takeover broadcasts NOTHING (not just writes nothing)', async () => {
    let release!: () => void;
    const paused = new Promise<void>((r) => (release = r));
    let pausedOnce = false;
    const realPrepare = chain.prepare.bind(chain);
    chain.prepare = async (input) => {
      const p = await realPrepare(input);
      if (!pausedOnce) {
        pausedOnce = true;
        await paused; // holder A stops between signing and its pre-broadcast fence check
      }
      return p;
    };
    const a = adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' }).catch((e) => e);
    while (!pausedOnce) await new Promise((r) => setImmediate(r));
    now += 31_000; // A's lease expired; B takes over and finishes
    await untilDone(() => adapter.prepareVault({ studyId: 's1', builderWallet: builder.publicKey.toBase58(), userId: 'b1' }));
    const aSig = chain.prepared[0]!.signature;
    release();
    expect(await a).toBeInstanceOf(SettlementPending);
    expect(chain.broadcasts.filter((b) => b.signature === aSig)).toEqual([]);
    expect(chain.landed.filter((l) => l.step === 'multisig_create')).toHaveLength(1);
  });

  it('20 concurrent settle runs: every step at most once, one execute', async () => {
    await readyVault();
    const [p] = await payouts(1);
    for (let r = 0; r < 4; r++) await Promise.allSettled(Array.from({ length: 20 }, () => settle()));
    await approveAsBuilder(p!.id);
    for (let r = 0; r < 4; r++) await Promise.allSettled(Array.from({ length: 20 }, () => settle()));
    expect(await statusOf(p!.id)).toBe('confirmed');
    for (const step of ['vault_tx_create', 'proposal_create', 'approve_platform', 'execute'] as const) expect(chain.landed.filter((l) => l.step === step), step).toHaveLength(1);
  });
});

describe('spend caps (CH-D1, pqa-be2 P2): the whole payment is reserved up front', () => {
  it('20 concurrent payouts under a cap that fits exactly 2 whole payments: 2 complete, 18 refused before any signature, none stranded', async () => {
    await readyVault();
    const vaultSpent = (await fs.collection('devnetSpend').doc('user:b1').get()).data()!.lamports as number;
    adapter = make({ global: { lamports: 1e12, usdcUnits: 1e12 }, perUser: { lamports: vaultSpent + 2 * paymentLamports(true), usdcUnits: 1e12 } });
    const ps = await payouts(20);
    await Promise.allSettled(Array.from({ length: 20 }, () => settle()));
    for (let i = 0; i < 6; i++) await settle();
    const receipts = (await fs.collection('squadsAttempts').get()).docs.map((d) => d.data());
    expect(receipts).toHaveLength(2);
    const waiting = [];
    for (const p of ps) if ((await statusOf(p.id)) === 'awaiting_approval') waiting.push(p);
    expect(waiting).toHaveLength(2);
    for (const p of waiting) await approveAsBuilder(p.id);
    for (let i = 0; i < 6; i++) await settle();
    for (const p of waiting) expect(await statusOf(p.id)).toBe('confirmed');
    expect(chain.landed.filter((l) => l.step === 'vault_tx_create')).toHaveLength(2); // nothing half-created
    const failed = await Promise.all(ps.map(async (p) => (await repos.escrow.payoutSettlementOf(p.id))!));
    expect(failed.filter((s) => s.status === 'failed').every((s) => /DEVNET_SPEND_CAP/.test(s.failure_reason ?? ''))).toBe(true);
  });
});

describe('the builder’s approval routes (CH-D3, pqa-be2 flag 5)', () => {
  it('an approval naming another index or op id is refused; a vote not on chain is not seen', async () => {
    await readyVault();
    const [p] = await payouts(1);
    for (let i = 0; i < 6; i++) await settle();
    const s = (await repos.escrow.payoutSettlementOf(p!.id))!;
    const a = await adapter.approval(s, builder.publicKey.toBase58());
    await expect(adapter.submitApproval(s, { signature: '5'.repeat(88), txIndex: a.txIndex + 1, opId: a.opId }, builder.publicKey.toBase58())).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
    await expect(adapter.submitApproval(s, { signature: '5'.repeat(88), txIndex: a.txIndex, opId: `pqa-op1:${'0'.repeat(64)}` }, builder.publicKey.toBase58())).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
    await expect(adapter.submitApproval(s, { signature: '5'.repeat(88), txIndex: a.txIndex, opId: a.opId }, builder.publicKey.toBase58())).rejects.toMatchObject({ code: 'COSIGNER_NOT_SEEN' });
    await expect(adapter.approval(s, Keypair.generate().publicKey.toBase58())).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    expect(chain.prepared.map((x) => x.step)).not.toContain('approve_platform');
  });

  it('the funding transaction is built from the server’s state: this study’s vault, the quoted amount, the reference', async () => {
    await readyVault();
    const f = { id: 'f1', study_id: 's1', amount_units: 3_000, reference: adapter.newReference(), status: 'awaiting_payment' as const, signature: null, source: null, failure_reason: null, created_at: now, expires_at: now + 60_000, confirmed_at: null };
    const tx = await adapter.fundingTransaction(f, builder.publicKey.toBase58());
    expect(tx).toMatchObject({ fundingId: 'f1', studyId: 's1', amountUnits: 3_000, destination: adapter.vaultFor('s1'), mint: PILOT_MINT, network: 'devnet' });
    expect(JSON.parse(Buffer.from(tx.transactionB64, 'base64').toString('utf8'))).toMatchObject({ from: builder.publicKey.toBase58(), vaultAta: adapter.vaultFor('s1'), amount: '3000', reference: f.reference });
    await expect(adapter.fundingTransaction({ ...f, expires_at: now }, builder.publicKey.toBase58())).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  });
});
