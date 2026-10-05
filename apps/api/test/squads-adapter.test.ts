import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db';
import { operationId, SquadsDevnetSettlement } from '../src/settlement/squads/adapter';
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

const OP = operationId('payout', 's1', null);
/** The vault transaction the adapter plans for pay1, as the program would store it. */
const goodTx = (over: Record<string, unknown> = {}) => {
  const a = squads.accountsFor('s1');
  return { creator: chain.keys.pocketqa, operation: OP, instructions: 2, program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', opcode: 12, source: a.vaultAta, mint: PILOT_MINT, destination: chain.ataOf(TESTER), authority: a.vaultAuthority, amount: 1_000_000n, decimals: 6, ...over };
};

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
    // No rent collector: Squads then refuses to close finished transactions, so operation records stay on chain.
    expect(ms).toMatchObject({ threshold: 2, configAuthority: '11111111111111111111111111111111', timeLock: 0, rentCollector: null });
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
      { rentCollector: chain.keys.pocketqa },
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
  it('refuses when the Squads or Memo program is not the pinned executable', async () => {
    chain.programOk = false;
    await expect(squads.submit(payout())).rejects.toBeInstanceOf(SettlementFailure);
    chain.programOk = true;
    chain.memoOk = false;
    await expect(squads.submit(payout())).rejects.toThrow(/Memo program/);
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
    await expect(squads.submit(payout())).rejects.toThrow(/holds less than it on devnet/);
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
    // Exactly [TransferChecked(plan), Memo(operation id)], created by Pocket QA.
    expect(tx).toEqual(goodTx());
    expect(OP).toMatch(/^pqa-op1:[0-9a-f]{64}$/);
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
    await expect(squads.submit(payout())).rejects.toThrow(/Stopped before creating Squads transaction 2: Squads creates only index 1 next/);
    expect(chain.sent.map((s) => s.step)).not.toContain('createVaultTransfer');
    // Its own claim is released (nothing exists at index 2), so it never blocks others in turn.
    expect(db.prepare('SELECT tx_index FROM squads_attempts WHERE settlement_id = ?').get('pay1')).toBeUndefined();
  });

  it('a multisig whose config changed after preparation is refused before anything is sent (R1)', async () => {
    chain.multisigs.get(squads.accountsFor('s1').multisig)!.threshold = 1;
    chain.sent.length = 0;
    await expect(squads.submit(payout())).rejects.toThrow(/multisig config/);
    expect(chain.sent).toEqual([]);
  });

  it('an occupied index holding a different transfer is refused, never approved (C3)', async () => {
    const ms = squads.accountsFor('s1').multisig;
    chain.vaultTxs.set(`${ms}:1`, goodTx({ operation: null, amount: 999n, destination: chain.ataOf(chain.keys.outsider) }) as never);
    chain.multisigs.get(ms)!.transactionIndex = 0n; // the next index the adapter will claim is 1
    await expect(squads.submit(payout())).rejects.toThrow(/not exactly this payment|carries this payment’s operation id but not its exact transfer or creator/);
    expect(chain.sent.filter((s) => s.step.startsWith('approve'))).toEqual([]);
  });

  it.each([
    ['no operation memo', { instructions: 1, operation: null }],
    ['another payment’s operation id', { operation: operationId('payout', 's1', 'someone-else') }],
    ['a creator other than Pocket QA', { creator: Keypair.generate().publicKey.toBase58() }],
    ['three instructions', { instructions: 3 }],
    ['not the Token program', { program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE9n9TZTnQ27fDZ' }],
    ['a plain Transfer (no checked decimals)', { opcode: 3 }],
    ['the wrong amount', { amount: 1_000_001n }],
    ['another destination', { destination: Keypair.generate().publicKey.toBase58() }],
    ['another source account', { source: Keypair.generate().publicKey.toBase58() }],
    ['other decimals', { decimals: 9 }],
  ])('refuses %s at an existing index', async (_, patch) => {
    const a = squads.accountsFor('s1');
    chain.vaultTxs.set(`${a.multisig}:1`, goodTx(patch) as never);
    chain.multisigs.get(a.multisig)!.transactionIndex = 0n;
    await expect(squads.submit(payout())).rejects.toThrow(/not exactly this payment|carries this payment’s operation id but not its exact transfer or creator/);
  });
});

describe('recovery when the local index mapping is lost, e.g. a database restore (pqa-qa offline r1 P1-1)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.fundVault(squads.vaultFor('s1'), 2_200_000);
  });
  const forget = () => db.prepare('DELETE FROM squads_attempts').run();

  it.each(['createVaultTransfer', 'approve:pocketqa', 'approve:builder', 'execute'])(
    'mapping lost after %s landed: the retry adopts the on-chain transaction, never a second transfer',
    async (step) => {
      chain.crashAfter = step;
      await expect(squads.submit(payout())).rejects.toThrow(/simulated crash/);
      chain.crashAfter = null;
      forget();
      const again = await squads.submit(payout({ key: 'pay1:9' }));
      expect(chain.sent.filter((s) => s.step === 'createVaultTransfer')).toHaveLength(1);
      expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(1);
      expect(again.signature).toBe(chain.sent.find((s) => s.step === 'execute')!.signature);
      expect(chain.balances.get(chain.ataOf(TESTER))).toBe(1_000_000);
      expect(db.prepare('SELECT tx_index FROM squads_attempts WHERE settlement_id = ?').get('pay1')).toEqual({ tx_index: 1 });
    },
  );

  it('mapping lost after a completed payout: the retry returns the same execute signature', async () => {
    const first = await squads.submit(payout());
    forget();
    expect(await squads.submit(payout({ key: 'pay1:2' }))).toEqual(first);
    expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(1);
    expect(chain.balances.get(chain.ataOf(TESTER))).toBe(1_000_000);
  });

  it('a matching transaction already claimed by another settlement is refused, never adopted twice', async () => {
    await squads.submit(payout());
    db.exec(`INSERT INTO settlements (id,kind,study_id,destination,amount_units,status,next_attempt_at,created_at) VALUES ('payX','payout','s1','${TESTER}',1000000,'submitted',0,0);`);
    await expect(squads.submit(payout({ settlementId: 'payX', key: 'payX:1' }))).rejects.toThrow(/already belongs to another settlement/);
    expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(1);
  });

  it('a carrier of this operation id with any other payload is refused at recovery, and never mapped', async () => {
    const a = squads.accountsFor('s1');
    chain.vaultTxs.set(`${a.multisig}:1`, goodTx({ amount: 999_999n }) as never);
    chain.multisigs.get(a.multisig)!.transactionIndex = 1n;
    chain.sent.length = 0;
    await expect(squads.submit(payout())).rejects.toThrow(/Squads transaction 1 carries this payment’s operation id but not its exact transfer or creator/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM squads_attempts').get()).toEqual({ n: 0 });
    expect(chain.sent.filter((s) => s.step !== 'ensureAta')).toEqual([]);
  });

  it('two on-chain transactions carrying one operation id are refused for an operator', async () => {
    const a = squads.accountsFor('s1');
    chain.vaultTxs.set(`${a.multisig}:1`, goodTx() as never);
    chain.vaultTxs.set(`${a.multisig}:2`, goodTx() as never);
    chain.multisigs.get(a.multisig)!.transactionIndex = 2n;
    await expect(squads.submit(payout())).rejects.toThrow(/2 Squads transactions of this study \(indexes 1, 2\) carry this payment’s operation id/);
    expect(chain.sent.filter((s) => s.step.startsWith('approve'))).toEqual([]);
  });
});

describe('operation identity, not transfer equality (parent and pqa-qa amendment)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.fundVault(squads.vaultFor('s1'), 3_000_000);
    // Two legitimate payouts with the same vault, wallet and amount, for different participations.
    db.exec(`UPDATE settlements SET participation_id = 'part-a' WHERE id = 'pay1';
      INSERT INTO settlements (id,kind,study_id,participation_id,destination,amount_units,status,next_attempt_at,created_at) VALUES ('pay2','payout','s1','part-b','${TESTER}',1000000,'submitted',0,0);`);
  });

  it('identical transfers with different operation ids each settle once and are never adopted for each other', async () => {
    const one = await squads.submit(payout());
    const two = await squads.submit(payout({ settlementId: 'pay2', key: 'pay2:1' }));
    expect(one.signature).not.toBe(two.signature);
    expect(chain.balances.get(chain.ataOf(TESTER))).toBe(2_000_000);
    const ops = [...chain.vaultTxs.values()].map((v) => v.operation);
    expect(ops).toEqual([operationId('payout', 's1', 'part-a'), operationId('payout', 's1', 'part-b')]);
    // Both mappings lost: each retry finds its own operation, nothing moves again.
    db.prepare('DELETE FROM squads_attempts').run();
    expect(await squads.submit(payout({ settlementId: 'pay2', key: 'pay2:2' }))).toEqual(two);
    expect(await squads.submit(payout({ key: 'pay1:2' }))).toEqual(one);
    expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(2);
    expect(chain.balances.get(chain.ataOf(TESTER))).toBe(2_000_000);
  });

  it('the second payout is created fresh while the first is mid-flight with its mapping lost', async () => {
    chain.crashAfter = 'approve:pocketqa';
    await expect(squads.submit(payout())).rejects.toThrow(/simulated crash/);
    chain.crashAfter = null;
    db.prepare('DELETE FROM squads_attempts').run();
    await squads.submit(payout({ settlementId: 'pay2', key: 'pay2:1' }));
    await squads.submit(payout({ key: 'pay1:2' }));
    expect(db.prepare('SELECT settlement_id, tx_index FROM squads_attempts ORDER BY tx_index').all()).toEqual([
      { settlement_id: 'pay1', tx_index: 1 },
      { settlement_id: 'pay2', tx_index: 2 },
    ]);
    expect(chain.sent.filter((s) => s.step === 'execute')).toHaveLength(2);
    expect(chain.balances.get(chain.ataOf(TESTER))).toBe(2_000_000);
  });
});

describe('failure copy reflects the chain state read for that operation (pqa-qa P3-4, required)', () => {
  beforeEach(async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
  });
  const failure = async (over = {}) => {
    const e = await squads.submit(payout(over)).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(SettlementFailure);
    return e as SettlementFailure;
  };
  it('on a non-devnet RPC the state is not read as devnet’s', async () => {
    chain.genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    const e = await failure();
    expect(e.chainState).toMatch(/the RPC is not devnet, so the devnet state of this payment was not read/);
  });
  it('refused before any chain read: says the state was not read, never "nothing sent"', async () => {
    const e = await failure({ amountUnits: 7 });
    expect(e.chainState).toMatch(/stopped before signing; the devnet state of this payment was not read/);
  });
  it('not created: proven by a scan of the multisig for the operation id', async () => {
    chain.fundVault(squads.vaultFor('s1'), 1);
    const e = await failure();
    expect(e.chainState).toBe('On devnet now: not created (no Squads transaction carries this payment’s operation id).');
  });
  it('awaiting approvals, after an earlier attempt landed its proposal', async () => {
    chain.fundVault(squads.vaultFor('s1'), 2_000_000);
    chain.crashAfter = 'approve:pocketqa';
    await expect(squads.submit(payout())).rejects.toThrow(/simulated crash/);
    chain.crashAfter = null;
    chain.mintAccount = { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 9 };
    const e = await failure({ key: 'pay1:2' });
    expect(e.message).toMatch(/Refused before signing/);
    expect(e.chainState).toBe('On devnet now: Squads transaction 1 awaiting approvals (1 of 2).');
  });
  it('executed, with the signature, when a pin fails after the payout landed', async () => {
    chain.fundVault(squads.vaultFor('s1'), 2_000_000);
    const { signature } = await squads.submit(payout());
    db.prepare('DELETE FROM squads_attempts').run();
    chain.programOk = false;
    const e = await failure({ key: 'pay1:2' });
    expect(e.chainState).toBe(`On devnet now: Squads transaction 1 executed (signature ${signature}, confirming).`);
  });
  it('unknown when the read itself fails', async () => {
    chain.fundVault(squads.vaultFor('s1'), 1);
    chain.getProposal = async () => {
      throw new Error('rpc down');
    };
    chain.vaultTxs.set(`${squads.accountsFor('s1').multisig}:1`, goodTx({ amount: 5n }) as never);
    chain.multisigs.get(squads.accountsFor('s1').multisig)!.transactionIndex = 1n;
    const e = await failure();
    expect(e.chainState).toBe('On devnet now: unknown (the read failed); checking again on the next run.');
  });
});

describe('claims released on a definitive failure before creation (pqa-qa offline r1 P3-1)', () => {
  it('a payout the vault can’t cover releases its index, so the next settlement isn’t blocked behind it', async () => {
    await squads.prepareVault({ studyId: 's1', builderWallet: chain.keys.builder });
    chain.fundVault(squads.vaultFor('s1'), 500_000);
    await expect(squads.submit(payout())).rejects.toThrow(/holds less than it on devnet/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM squads_attempts').get()).toEqual({ n: 0 });
    const other = Keypair.generate().publicKey.toBase58();
    db.exec(`INSERT INTO settlements (id,kind,study_id,destination,amount_units,status,next_attempt_at,created_at) VALUES ('ref1','refund','s1','${other}',500000,'submitted',0,0);`);
    await squads.submit(payout({ settlementId: 'ref1', key: 'ref1:1', kind: 'refund', destination: other, amountUnits: 500_000 }));
    expect(db.prepare('SELECT tx_index FROM squads_attempts WHERE settlement_id = ?').get('ref1')).toEqual({ tx_index: 1 });
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
  it('a funding from an off-curve owner (a program address) has no refundable wallet (pqa-qa offline r1 P3-2)', async () => {
    const a = squads.accountsFor('s1');
    const ref = squads.newReference();
    const sig = chain.recordFunding({ from: a.multisig, toAta: a.vaultAta, amount: 2_200_000, reference: ref });
    expect((await squads.getTransfer(sig, { vault: a.vaultAta, reference: ref }))!.source).toBe('');
  });
  it('a funding from an on-curve wallet keeps its source', async () => {
    const a = squads.accountsFor('s1');
    const ref = squads.newReference();
    const sig = chain.recordFunding({ from: chain.keys.builder, toAta: a.vaultAta, amount: 2_200_000, reference: ref });
    expect((await squads.getTransfer(sig, { vault: a.vaultAta, reference: ref }))!.source).toBe(chain.keys.builder);
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
