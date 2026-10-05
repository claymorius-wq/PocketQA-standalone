import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db';
import { SquadsDevnetSettlement } from '../src/settlement/squads/adapter';
import { DEVNET_GENESIS, PILOT_MINT } from '../src/settlement/squads/pins';
import { SettlementFailure } from '../src/settlement/types';
import { FakeSquadsChain } from './fakeSquadsChain';

// Squads devnet pilot adapter (ADR 0007 §10), against an in-memory chain that can crash after any
// step. Covers pqa-qa devnet matrix C2 (pinning before signing), C3 (transferChecked-only plan),
// C5 (idempotency and recovery), R1 (autonomous 2-of-3, no spending limits), R3/R6.
let db: DB;
let chain: FakeSquadsChain;
let squads: SquadsDevnetSettlement;
const SEED = new Uint8Array(32).fill(7);
const TESTER = Keypair.generate().publicKey.toBase58();

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'pqa-squads-')), 'x.sqlite'));
  chain = new FakeSquadsChain();
  squads = new SquadsDevnetSettlement({ db, now: () => 1_800_000_000_000, chain, createSeed: SEED });
  // A study and a settlement row the adapter can reference (the worker owns their lifecycle).
  db.exec(`INSERT INTO users (id,email,password_hash,display_name,role,status,created_at) VALUES ('b','b@x.test',NULL,'B','builder','active','2026-10-05T00:00:00Z');
    INSERT INTO studies (id,builder_id,title,objective,device_criteria_json,reward_credits,payment_mode,slots,consent_text,status,created_at) VALUES ('s1','b','T','Objective text here','{}',1000000,'escrow',2,'Consent text long enough here','published','2026-10-05T00:00:00Z');
    INSERT INTO settlements (id,kind,study_id,destination,amount_units,status,next_attempt_at,created_at) VALUES ('pay1','payout','s1','${TESTER}',1000000,'submitted',0,0);`);
});
afterEach(() => db.close());

const payout = (over: Partial<Parameters<SquadsDevnetSettlement['submit']>[0]> = {}) => ({
  key: 'pay1:1',
  settlementId: 'pay1',
  kind: 'payout' as const,
  studyId: 's1',
  vault: squads.vaultFor('s1'),
  destination: TESTER,
  amountUnits: 1_000_000,
  cosigner: 'builder' as const,
  ...over,
});

describe('vault preparation (R1)', () => {
  it('creates an autonomous 2-of-3 multisig (builder Vote, Pocket QA Initiate+Vote+Execute, arbiter Vote), once', async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    expect(chain.created).toBe(1);
    const ms = chain.multisigs.get(squads.accountsFor('s1').multisig)!;
    expect(ms).toMatchObject({ threshold: 2, configAuthority: '11111111111111111111111111111111', timeLock: 0 });
    expect(ms.members).toHaveLength(3);
    expect(ms.members).toEqual(expect.arrayContaining([
      { key: chain.keys.builder, mask: 2 },
      { key: chain.keys.pocketqa, mask: 7 },
      { key: chain.keys.arbiter, mask: 2 },
    ]));
    // Only the multisig and the vault's token account were created: no config transaction, so no spending limit.
    expect(chain.sent.map((s) => s.step)).toEqual(['createMultisig', 'ensureAta']);
    expect(chain.atas.has(squads.vaultFor('s1'))).toBe(true);
  });

  it('refuses a builder wallet that is not the pilot builder test key (the adapter could not sign its approvals)', async () => {
    await expect(squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.outsider })).rejects.toThrow(/pilot builder test key/);
    expect(chain.sent).toEqual([]);
  });

  it('refuses a vault whose on-chain config differs (controlled, threshold 1, extra member)', async () => {
    const acc = squads.accountsFor('s1');
    for (const bad of [
      { configAuthority: chain.keys.pocketqa },
      { threshold: 1 },
      { members: [...chain.defaultMembers(chain.keys.builder), { key: chain.keys.outsider, mask: 7 }] },
    ]) {
      chain.multisigs.set(acc.multisig, { ...chain.goodMultisig(chain.keys.builder), ...bad });
      await expect(squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder })).rejects.toThrow(/multisig config/i);
    }
  });
});

describe('pinning before any signature (C2)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.fundVault(squads.vaultFor('s1'), 2_200_000);
    chain.sent.length = 0;
  });
  it('refuses a non-devnet genesis without sending anything', async () => {
    chain.genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'; // mainnet
    await expect(squads.submit(payout())).rejects.toBeInstanceOf(SettlementFailure);
    expect(chain.sent).toEqual([]);
  });
  it('refuses a mint that is not classic-Token, 6-decimal Circle devnet USDC', async () => {
    chain.mintAccount = { owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE9n9TZTnQ27fDZ', decimals: 6 };
    await expect(squads.submit(payout())).rejects.toBeInstanceOf(SettlementFailure);
    chain.mintAccount = { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 9 };
    await expect(squads.submit(payout())).rejects.toBeInstanceOf(SettlementFailure);
    chain.mintAccount = null;
    await expect(squads.submit(payout())).rejects.toBeInstanceOf(SettlementFailure);
    expect(chain.sent).toEqual([]);
  });
  it('refuses when the Squads program is not the pinned executable', async () => {
    chain.programOk = false;
    await expect(squads.submit(payout())).rejects.toBeInstanceOf(SettlementFailure);
    expect(chain.sent).toEqual([]);
  });
});

describe('destination and amount policy', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.fundVault(squads.vaultFor('s1'), 2_200_000);
    chain.sent.length = 0;
  });
  it.each([
    ['a different destination than the recorded settlement', { destination: Keypair.generate().publicKey.toBase58() }],
    ['a different amount than the recorded settlement', { amountUnits: 1_000_001 }],
    ['a different study', { studyId: 's2' }],
    ['a source that is not the study vault', { vault: Keypair.generate().publicKey.toBase58() }],
  ])('refuses %s without sending anything', async (_, over) => {
    await expect(squads.submit(payout(over))).rejects.toBeInstanceOf(SettlementFailure);
    expect(chain.sent).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM squads_attempts').get()).toEqual({ n: 0 });
  });
  it('refuses an off-curve destination (a program address, not a wallet)', async () => {
    const pda = squads.accountsFor('s1').vaultAuthority;
    db.prepare('UPDATE settlements SET destination = ? WHERE id = ?').run(pda, 'pay1');
    await expect(squads.submit(payout({ destination: pda }))).rejects.toThrow(/not a wallet address/);
    expect(chain.sent).toEqual([]);
  });
  it('refuses a payout larger than the vault holds, before creating anything', async () => {
    chain.balances.set(squads.vaultFor('s1'), 999_999);
    await expect(squads.submit(payout())).rejects.toThrow(/holds less than this transfer/);
    expect(chain.sent.map((s) => s.step)).not.toContain('createVaultTransfer');
  });
});

describe('payout: one transferChecked, two distinct approvals, executed once (R3, C3)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.sent.length = 0;
  });

  it('proposes exactly the frozen destination and amount, approved by Pocket QA and the builder', async () => {
    chain.fundVault(squads.accountsFor('s1').vaultAta, 2_200_000);
    const { signature } = await squads.submit(payout());
    expect(chain.sent.map((s) => s.step)).toEqual(['ensureAta', 'createVaultTransfer', 'createProposal', 'approve:pocketqa', 'approve:builder', 'execute']);
    const tx = chain.vaultTxs.get(`${squads.accountsFor('s1').multisig}:1`)!;
    expect(tx).toEqual({ instructions: 1, program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', opcode: 12, source: squads.vaultFor('s1'), mint: PILOT_MINT, destination: chain.ataOf(TESTER), authority: squads.accountsFor('s1').vaultAuthority, amount: 1_000_000n, decimals: 6 });
    expect(chain.balances.get(squads.vaultFor('s1'))).toBe(1_200_000);
    expect(await squads.status(signature)).toBe('finalized');
    expect(chain.balances.get(chain.ataOf(TESTER))).toBe(1_000_000);
  });

  it('an overturned dispute is co-signed by the arbiter instead of the builder', async () => {
    chain.fundVault(squads.accountsFor('s1').vaultAta, 2_200_000);
    await squads.submit(payout({ cosigner: 'arbiter' }));
    expect(chain.sent.map((s) => s.step)).toContain('approve:arbiter');
    expect(chain.sent.map((s) => s.step)).not.toContain('approve:builder');
  });

  it('never executes with fewer than two approvals (the fake enforces the threshold like the program)', async () => {
    chain.fundVault(squads.accountsFor('s1').vaultAta, 2_200_000);
    chain.failApprovalFor = 'builder';
    await expect(squads.submit(payout())).rejects.toThrow();
    expect(chain.sent.map((s) => s.step)).not.toContain('execute');
    expect(chain.balances.get(chain.ataOf(TESTER)) ?? 0).toBe(0);
  });
});

describe('idempotent recovery (C5, R6)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.fundVault(squads.accountsFor('s1').vaultAta, 2_200_000);
  });

  it.each(['createVaultTransfer', 'createProposal', 'approve:pocketqa', 'approve:builder', 'execute'])(
    'a crash right after %s resumes on the same index and moves funds exactly once',
    async (step) => {
      chain.crashAfter = step;
      await expect(squads.submit(payout())).rejects.toThrow(/simulated crash/);
      chain.crashAfter = null;
      const again = await squads.submit(payout({ key: 'pay1:2' }));
      const third = await squads.submit(payout({ key: 'pay1:3' }));
      expect(third.signature).toBe(again.signature);
      expect(chain.sent.filter((s) => s.step === 'createVaultTransfer')).toHaveLength(1);
      expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(1);
      expect(chain.balances.get(chain.ataOf(TESTER))).toBe(1_000_000);
      expect(db.prepare('SELECT tx_index FROM squads_attempts WHERE settlement_id = ?').get('pay1')).toEqual({ tx_index: 1 });
    },
  );

  it('an earlier settlement’s claimed but uncreated index blocks this one: nothing is sent out of order', async () => {
    db.exec(`INSERT INTO settlements (id,kind,study_id,destination,amount_units,status,next_attempt_at,created_at) VALUES ('pay0','payout','s1','${TESTER}',1000000,'submitted',0,0);`);
    db.prepare('INSERT INTO squads_attempts (settlement_id, multisig, tx_index, created_at) VALUES (?,?,?,?)').run('pay0', squads.accountsFor('s1').multisig, 1, 0);
    chain.sent.length = 0;
    await expect(squads.submit(payout())).rejects.toThrow(/Waiting for Squads transaction 1/);
    expect(chain.sent.map((s) => s.step)).not.toContain('createVaultTransfer');
    expect(db.prepare('SELECT tx_index FROM squads_attempts WHERE settlement_id = ?').get('pay1')).toEqual({ tx_index: 2 });
  });

  it('a multisig whose config changed after preparation is refused before anything is sent (R1)', async () => {
    chain.multisigs.get(squads.accountsFor('s1').multisig)!.threshold = 1;
    chain.sent.length = 0;
    await expect(squads.submit(payout())).rejects.toThrow(/multisig config/);
    expect(chain.sent).toEqual([]);
  });

  it('an occupied index holding a different transfer is refused, never approved (C3)', async () => {
    const ms = squads.accountsFor('s1').multisig;
    chain.vaultTxs.set(`${ms}:1`, { amount: 999n, mint: PILOT_MINT, destination: chain.ataOf(chain.keys.outsider), source: squads.accountsFor('s1').vaultAta, authority: squads.accountsFor('s1').vaultAuthority, instructions: 1, program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', opcode: 12, decimals: 6 });
    chain.multisigs.get(ms)!.transactionIndex = 0n; // the next index the adapter will claim is 1
    await expect(squads.submit(payout())).rejects.toThrow(/does not match the planned transfer/);
    expect(chain.sent.filter((s) => s.step.startsWith('approve'))).toEqual([]);
  });

  it.each([
    ['two instructions', { instructions: 2 }],
    ['not the Token program', { program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE9n9TZTnQ27fDZ' }],
    ['a plain Transfer (no checked decimals)', { opcode: 3 }],
    ['the wrong amount', { amount: 1_000_001n }],
    ['another destination', { destination: Keypair.generate().publicKey.toBase58() }],
    ['another source account', { source: Keypair.generate().publicKey.toBase58() }],
    ['other decimals', { decimals: 9 }],
  ])('refuses %s at an existing index', async (_, patch) => {
    const a = squads.accountsFor('s1');
    chain.vaultTxs.set(`${a.multisig}:1`, { amount: 1_000_000n, mint: PILOT_MINT, destination: chain.ataOf(TESTER), source: a.vaultAta, authority: a.vaultAuthority, instructions: 1, program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', opcode: 12, decimals: 6, ...patch });
    chain.multisigs.get(a.multisig)!.transactionIndex = 0n;
    await expect(squads.submit(payout())).rejects.toThrow(/does not match the planned transfer/);
  });
});

describe('funding readback (R2, R8)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
  });
  it('reads the vault credit and funder from finalized balance deltas; wrong vault or mint credits nothing', async () => {
    const a = squads.accountsFor('s1');
    const ref = squads.newReference();
    const ok = chain.recordFunding({ from: chain.keys.builder, toAta: a.vaultAta, amount: 2_200_000, reference: ref });
    expect(await squads.getTransfer(ok, { vault: a.vaultAta, reference: ref })).toMatchObject({ status: 'finalized', network: 'solana:devnet', mint: PILOT_MINT, destination: a.vaultAta, amountUnits: 2_200_000, reference: ref, source: chain.keys.builder });
    const elsewhere = chain.recordFunding({ from: chain.keys.builder, toAta: chain.ataOf(chain.keys.outsider), amount: 2_200_000, reference: ref });
    expect((await squads.getTransfer(elsewhere, { vault: a.vaultAta, reference: ref }))!.destination).toBe('');
    const otherMint = chain.recordFunding({ from: chain.keys.builder, toAta: a.vaultAta, amount: 2_200_000, reference: ref, mint: 'So11111111111111111111111111111111111111112' });
    expect((await squads.getTransfer(otherMint, { vault: a.vaultAta, reference: ref }))!.amountUnits).toBe(0);
  });
  it('a transfer seen on a non-devnet cluster is never credited', async () => {
    const a = squads.accountsFor('s1');
    const ref = squads.newReference();
    const sig = chain.recordFunding({ from: chain.keys.builder, toAta: a.vaultAta, amount: 1, reference: ref });
    chain.genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    expect((await squads.getTransfer(sig, { vault: a.vaultAta, reference: ref }))!.network).not.toBe('solana:devnet');
  });
});

describe('reconciliation readback (R7)', () => {
  it('reports the vault token account’s finalized balance, including a stray deposit the books never credited', async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    const a = squads.accountsFor('s1');
    chain.recordFunding({ from: chain.keys.outsider, toAta: a.vaultAta, amount: 1234, reference: squads.newReference() });
    expect(await squads.vaultBalance('s1')).toBe(1234);
    chain.genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    expect(await squads.vaultBalance('s1')).toBeNull();
  });
});

it('pins are what ADR 0007 §10 says', () => {
  expect(DEVNET_GENESIS).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  expect(PILOT_MINT).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
});
