/* eslint-disable @typescript-eslint/no-unused-vars -- evidence copy kept verbatim (lint-only header; no code changed) */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type SendOptions, type TransactionInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { base58 } from '@scure/base';
import { afterAll, describe, expect, it } from 'vitest';
import { Study } from '@pocket-qa/contracts';
import { studyEscrowBooks } from '../src/escrow';
import { operationId, SquadsDevnetSettlement } from '../src/settlement/squads/adapter';
import { DEVNET_GENESIS, MEMO_PROGRAM, PILOT_MINT, SQUADS_PROGRAM } from '../src/settlement/squads/pins';
import { DEVNET_RPC, loadPilotKeys, RpcSquadsChain } from '../src/settlement/squads/rpcChain';
import { runSettlement } from '../src/settlement/worker';
import { DEVICE, makeApp, STUDY, type TestApp } from '../test/helpers';

/**
 * pqa-ios full-e2e row D-08: a FRESH, BOUNDED Squads v4 devnet pilot run (Hamza's explicit
 * authorization for scoped devnet testing with the existing pilot key directory, 2026-10-06).
 * Same real API, worker and adapter as squads-devnet.pilot.live.test.ts (in-process, temporary
 * SQLite), reduced to Hamza's bounds and with a WRITE-AHEAD receipt:
 *  - funding <= 3,000,000 test-USDC units in total (this run: 2 slots x 1.00 + 10 % fee = 2.20);
 *  - devnet SOL spent (fees AND rent) <= 0.05 SOL, checked against the live balance before every send;
 *  - every send is journaled (operation id, decoded intended instructions, signature prefix + sha256)
 *    and fsynced BEFORE sendTransaction; a raw send that bypasses the journal is refused;
 *  - one crash right after the payout's execute LANDS, with the local Squads state wiped: recovery
 *    must adopt by operation id, never re-send; one on-chain refusal (second execute).
 * Full signatures never reach the repo: they go to D08_PRIVATE (scratch) for the readback only.
 * Skipped unless POCKETQA_LIVE_D08=1, POCKETQA_LIVE_SQUADS_KEYS_DIR, D08_OUT and D08_PRIVATE are set.
 */
const LIVE = process.env.POCKETQA_LIVE_D08 === '1';
const KEYS_DIR = process.env.POCKETQA_LIVE_SQUADS_KEYS_DIR ?? '';
const OUT = process.env.D08_OUT ?? '';
const PRIVATE = process.env.D08_PRIVATE ?? '';
const d = LIVE ? describe : describe.skip;

const USDC = 1_000_000;
const MAX_FUNDING_UNITS = 3_000_000n;
const MAX_SPEND_LAMPORTS = 50_000_000; // 0.05 SOL, fees and rent together
const STOP_AT_LAMPORTS = 45_000_000; // refuse any further send past this (margin for one more)
const MINT = new PublicKey(PILOT_MINT);
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const pub = (sig: string) => ({ signaturePrefix: `${sig.slice(0, 12)}…`, signatureSha256: sha(sig) });

type Intent = { op: string; step: string; detail?: Record<string, unknown> };
let seq = 0;
const fullSigs: { seq: number; op: string; step: string; signature: string }[] = [];

function journal(entry: Record<string, unknown>) {
  const file = join(OUT, 'd08-write-ahead-journal.jsonl');
  const fd = openSync(file, 'a');
  appendFileSync(fd, `${JSON.stringify(entry)}\n`);
  fsyncSync(fd);
  closeSync(fd);
}

/** Decodes what a signed transaction will do (programs, token transfers, memos) for the journal. */
function describeTx(tx: VersionedTransaction) {
  const m = tx.message;
  const keys = m.staticAccountKeys.map((k) => k.toBase58());
  return m.compiledInstructions.map((ix) => {
    const program = keys[ix.programIdIndex] ?? `lut:${ix.programIdIndex}`;
    const data = Buffer.from(ix.data);
    const accounts = ix.accountKeyIndexes.map((i) => keys[i] ?? `lut:${i}`);
    if (program === TOKEN_PROGRAM && data[0] === 12) return { program: 'spl-token', ix: 'TransferChecked', source: accounts[0], mint: accounts[1], destination: accounts[2], authority: accounts[3], amountUnits: data.readBigUInt64LE(1).toString(), decimals: data[9] };
    if (program === MEMO_PROGRAM) return { program: 'memo', text: data.toString('utf8') };
    if (program === SQUADS_PROGRAM) return { program: 'squads-v4', discriminatorHex: data.subarray(0, 8).toString('hex'), dataBytes: data.length };
    return { program, dataBytes: data.length };
  });
}

/** The ONLY path to the network: journal, bound-check, then send. */
class JournalConnection extends Connection {
  intent: Intent | null = null;
  startLamports = 0;
  payer: PublicKey | null = null;
  private inJournaledSend = false;

  // @ts-expect-error web3.js overloads sendTransaction (legacy + versioned); only versioned is accepted here
  override async sendTransaction(tx: VersionedTransaction, options?: SendOptions): Promise<string> {
    const intent = this.intent ?? { op: 'unlabelled', step: 'unlabelled' };
    if (!(tx instanceof VersionedTransaction)) throw new Error('refused: only versioned transactions are expected');
    if ((await this.getGenesisHash()) !== DEVNET_GENESIS) throw new Error('refused: not devnet');
    const now = await this.getBalance(this.payer!, 'finalized');
    const spent = this.startLamports - now;
    if (spent >= STOP_AT_LAMPORTS) throw new Error(`refused by bound: ${spent} lamports spent (stop at ${STOP_AT_LAMPORTS}); nothing sent`);
    const signature = base58.encode(tx.signatures[0]!);
    const n = ++seq;
    journal({ seq: n, writtenAt: new Date().toISOString(), op: intent.op, step: intent.step, detail: intent.detail ?? null, feePayer: tx.message.staticAccountKeys[0]!.toBase58(), recentBlockhash: tx.message.recentBlockhash, messageSha256: sha(tx.message.serialize()), instructions: describeTx(tx), ...pub(signature), spentLamportsBeforeSend: spent, state: 'written before send' });
    fullSigs.push({ seq: n, op: intent.op, step: intent.step, signature });
    writeFileSync(PRIVATE, JSON.stringify(fullSigs, null, 2));
    this.inJournaledSend = true;
    try {
      return await super.sendTransaction(tx, options);
    } finally {
      this.inJournaledSend = false;
    }
  }

  override async sendRawTransaction(raw: Buffer | Uint8Array | number[], options?: SendOptions): Promise<string> {
    if (!this.inJournaledSend) throw new Error('refused: raw send outside the journal');
    return super.sendRawTransaction(raw, options);
  }
}

d('D-08 fresh bounded devnet pilot run (pqa-ios)', () => {
  const conn = new JournalConnection(DEVNET_RPC, 'finalized');
  const { signers, createSeed } = LIVE ? loadPilotKeys(KEYS_DIR) : { signers: { builder: Keypair.generate(), pocketqa: Keypair.generate(), arbiter: Keypair.generate() }, createSeed: new Uint8Array(32) };
  const tester = LIVE ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, 'tester.json'), 'utf8')) as number[])) : Keypair.generate();
  const { pocketqa, builder } = signers;
  conn.payer = pocketqa.publicKey;
  const opByIndex = new Map<string, string>();
  const report: Record<string, unknown> = { label: 'fresh devnet pilot run (SQLite, server-held pilot keys)', authorization: 'Hamza, 2026-10-06, relayed by pocketqa-lead: bounded fresh devnet-only test transactions with the existing ~/.config/pocketqa-devnet-pilot fixtures; no secrets printed; not mainnet/real funds/billing/deletion.', disclosure: 'Devnet test USDC and devnet SOL (no value). Test keys simulate every role (builder, Pocket QA, arbiter, tester); not independent custody; no physical wallet.', bounds: { maxFundingUnits: String(MAX_FUNDING_UNITS), maxSpendLamports: MAX_SPEND_LAMPORTS, stopAtLamports: STOP_AT_LAMPORTS }, checks: [] as unknown[] };
  const check = (id: string, claim: string, observed: unknown, ok: boolean) => {
    (report.checks as unknown[]).push({ id, claim, observed: JSON.parse(JSON.stringify(observed, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? 'null'), ok });
    expect(ok, `${id}: ${claim}`).toBe(true);
  };
  const save = () => writeFileSync(join(OUT, 'd08-report.json'), `${JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);

  /** Labels every chain call with its operation id before the adapter sends it. */
  class LabelledChain extends RpcSquadsChain {
    crashAfterExecute = false;
    override async createMultisig(input: Parameters<RpcSquadsChain['createMultisig']>[0]) {
      conn.intent = { op: `setup:multisig:${input.multisig}`, step: 'multisig_create', detail: { threshold: input.threshold, members: input.members } };
      return super.createMultisig(input);
    }
    override async ensureAta(owner: string) {
      conn.intent = { op: `setup:token-account:${owner}`, step: `token_account_create:${owner}` };
      return super.ensureAta(owner);
    }
    override async createVaultTransfer(input: Parameters<RpcSquadsChain['createVaultTransfer']>[0]) {
      opByIndex.set(input.index.toString(), input.operation);
      conn.intent = { op: input.operation, step: `vault_transaction_create:${input.index}`, detail: { source: input.source, destination: input.destination, amountUnits: input.amount.toString() } };
      return super.createVaultTransfer(input);
    }
    override async createProposal(ms: string, index: bigint) {
      conn.intent = { op: opByIndex.get(index.toString()) ?? `index:${index}`, step: `proposal_create:${index}` };
      return super.createProposal(ms, index);
    }
    override async approve(ms: string, index: bigint, role: 'builder' | 'pocketqa' | 'arbiter') {
      conn.intent = { op: opByIndex.get(index.toString()) ?? `index:${index}`, step: `proposal_approve:${index}:${role}` };
      return super.approve(ms, index, role);
    }
    override async execute(ms: string, index: bigint) {
      conn.intent = { op: opByIndex.get(index.toString()) ?? `index:${index}`, step: `vault_transaction_execute:${index}` };
      const sig = await super.execute(ms, index);
      if (this.crashAfterExecute) {
        this.crashAfterExecute = false;
        journal({ event: 'simulated crash right after execute landed', index: index.toString(), ...pub(sig), at: new Date().toISOString() });
        throw new Error(`simulated crash after execute ${index} landed`);
      }
      return sig;
    }
  }
  const landed: { step: string; signature: string; slot: number; feeLamports: number | null }[] = [];
  const chain = new LabelledChain(conn as unknown as Connection, signers, (s) => landed.push(s));
  let t: TestApp;

  afterAll(async () => {
    save();
    await t?.close();
  });

  /** Runner-side send (the builder wallet's funding, or the deliberate refusal). */
  async function send(intent: Intent, ixs: TransactionInstruction[], extra: Keypair[], expectFailure = false) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: pocketqa.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign([pocketqa, ...extra]);
    conn.intent = intent;
    const signature = await conn.sendTransaction(tx, { skipPreflight: expectFailure, maxRetries: 5 });
    const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'finalized').catch(async (e: unknown) => {
      if (e instanceof Error) throw e;
      for (let i = 0; i < 30; i++) {
        const st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (st?.confirmationStatus === 'finalized') return { value: { err: st.err } };
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(`${intent.step}: outcome unknown; inspect the chain before any retry`);
    });
    const err = res.value.err ? JSON.stringify(res.value.err) : null;
    if (!expectFailure && err) throw new Error(`${intent.step} failed: ${err}`);
    return { signature, err };
  }
  const tokens = async (a: string) => {
    const info = await conn.getAccountInfo(new PublicKey(a), 'finalized');
    return info ? BigInt((await conn.getTokenAccountBalance(new PublicKey(a), 'finalized')).value.amount) : null;
  };
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(MINT, owner, true).toBase58();

  it('funds, pays one tester through a crash, refunds, refuses a double execute, within bounds', { timeout: 60 * 60_000 }, async () => {
    mkdirSync(OUT, { recursive: true });
    // 1. Read-only preflight, recorded before anything is signed.
    const genesis = await conn.getGenesisHash();
    const mint = await chain.mintInfo(PILOT_MINT);
    const builderAta = ata(builder.publicKey);
    const testerAta = ata(tester.publicKey);
    conn.startLamports = await conn.getBalance(pocketqa.publicKey, 'finalized');
    const startBuilderUsdc = await tokens(builderAta);
    const startTesterUsdc = await tokens(testerAta);
    report.preflight = {
      at: new Date().toISOString(), rpc: DEVNET_RPC, genesis, mint: { address: PILOT_MINT, ...mint }, squadsProgram: SQUADS_PROGRAM, squadsProgramExecutable: await chain.programExecutable(), memoProgramExecutable: await chain.memoProgramExecutable(),
      roles: { builder: builder.publicKey.toBase58(), pocketqa: pocketqa.publicKey.toBase58(), arbiter: signers.arbiter.publicKey.toBase58(), tester: tester.publicKey.toBase58() },
      balances: { pocketqaLamports: conn.startLamports, builderUsdcUnits: startBuilderUsdc, testerUsdcUnits: startTesterUsdc },
    };
    save();
    check('B0', 'devnet genesis, pinned mint (classic Token, 6 decimals), Squads v4 and Memo executable', report.preflight, genesis === DEVNET_GENESIS && mint?.owner === TOKEN_PROGRAM && mint?.decimals === 6 && (report.preflight as { squadsProgramExecutable: boolean }).squadsProgramExecutable);
    check('B0', 'enough test funds for the bounded run (>= 0.06 SOL, >= 2.2 test USDC)', report.preflight, conn.startLamports >= 60_000_000 && (startBuilderUsdc ?? 0n) >= 2_200_000n);

    t = await makeApp({ settlement: 'squads_devnet', squadsChain: chain, squadsCreateSeed: createSeed });
    t.clock.now = Date.now();
    const adapter = t.deps.settlement as SquadsDevnetSettlement;
    const b = await t.register('builder');
    expect((await t.linkWallet(b.token, builder.secretKey.slice(0, 32))).address).toBe(builder.publicKey.toBase58());
    const { rewardCredits: _, ...rest } = STUDY;
    const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, title: 'QA synthetic D-08 bounded devnet study', slots: 2, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
    const acc = adapter.accountsFor(study.id);
    report.study = { id: study.id, slots: 2, rewardUnits: USDC, accounts: { ...acc, builderUsdcAta: builderAta, testerUsdcAta: testerAta } };

    // 2. Funding request (the adapter creates the multisig and the vault token account).
    const f = (await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body;
    check('B1', `funding quote within the bound (<= ${MAX_FUNDING_UNITS} units)`, f.amountUnits, BigInt(f.amountUnits) === 2_200_000n && BigInt(f.amountUnits) <= MAX_FUNDING_UNITS);
    const ms = await chain.getMultisig(acc.multisig);
    check('B1', 'new autonomous 2-of-3 multisig for this study', ms, !!ms && ms.threshold === 2 && ms.configAuthority === '11111111111111111111111111111111' && ms.rentCollector === null);

    // 3. The builder wallet funds the exact quote with the funding reference.
    const fund = createTransferCheckedInstruction(new PublicKey(builderAta), MINT, new PublicKey(acc.vaultAta), builder.publicKey, BigInt(f.amountUnits), 6);
    fund.keys.push({ pubkey: new PublicKey(f.reference), isSigner: false, isWritable: false });
    const funding = await send({ op: `funding:${f.id}`, step: 'runner:funding (builder wallet -> study vault)', detail: { reference: f.reference, amountUnits: String(f.amountUnits) } }, [fund], [builder]);
    landed.push({ step: 'runner:funding', signature: funding.signature, slot: 0, feeLamports: null });
    const fRes = (await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: funding.signature })).body;
    check('B2', 'funding confirmed from the builder wallet and credited once', { status: fRes.status, source: fRes.source }, fRes.status === 'confirmed' && fRes.source === builder.publicKey.toBase58());
    expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).status).toBe(200);

    // 4. One tester (the tester test key, whose token account already exists) is approved.
    const u = await t.register('tester');
    await t.req('PUT', '/me/device', u.token, DEVICE);
    const w = await t.linkWallet(u.token, tester.secretKey.slice(0, 32));
    const p = (await t.req('POST', `/studies/${study.id}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: w.address })).body;
    await t.req('POST', `/participations/${p.id}/start`, u.token);
    await t.req('POST', `/participations/${p.id}/submit`, u.token);
    await t.req('POST', `/participations/${p.id}/approve`, b.token, { helpful: true });
    const payoutOp = operationId('payout', study.id, p.id);
    report.operations = { payout: payoutOp, refund: operationId('refund', study.id, null), funding: `funding:${f.id}` };

    // 5. Crash right after the payout's execute LANDS; local Squads state wiped; recovery must adopt.
    chain.crashAfterExecute = true;
    await expect(runSettlement(t.deps)).rejects.toThrow(/simulated crash after execute/);
    const sendsBeforeRecovery = seq;
    t.db.prepare('DELETE FROM squads_attempts').run();
    t.db.prepare(`UPDATE settlements SET status = 'pending', attempt_key = NULL WHERE status = 'submitted' AND signature IS NULL`).run();
    for (let i = 0; i < 6 && (t.db.prepare(`SELECT COUNT(*) AS n FROM settlements WHERE kind = 'payout' AND status != 'confirmed'`).get() as { n: number }).n > 0; i++) await runSettlement(t.deps);
    const payout = t.db.prepare(`SELECT s.status, s.signature, s.amount_units, a.tx_index FROM settlements s JOIN squads_attempts a ON a.settlement_id = s.id WHERE kind = 'payout'`).get() as { status: string; signature: string; amount_units: number; tx_index: number };
    const executes = fullSigs.filter((s) => s.step === `vault_transaction_execute:${payout.tx_index}`);
    const creates = fullSigs.filter((s) => s.op === payoutOp && s.step.startsWith('vault_transaction_create'));
    check('B3', 'recovery adopted the landed payout by operation id: confirmed, no re-send (0 sends during recovery, exactly 1 execute and 1 vault transaction for the operation)', { status: payout.status, sendsDuringRecovery: seq - sendsBeforeRecovery, executes: executes.length, creates: creates.length, adoptedSignatureMatchesExecute: payout.signature === executes[0]?.signature }, payout.status === 'confirmed' && seq === sendsBeforeRecovery && executes.length === 1 && creates.length === 1 && payout.signature === executes[0]?.signature);
    check('B3', 'tester received exactly 1.00 test USDC', String(((await tokens(testerAta)) ?? 0n) - (startTesterUsdc ?? 0n)), ((await tokens(testerAta)) ?? 0n) - (startTesterUsdc ?? 0n) === 1_000_000n);

    // 6. Close: the unused slot's reward and fee are refunded to the funding wallet.
    const builderBefore = (await tokens(builderAta)) ?? 0n;
    expect((await t.req('POST', `/studies/${study.id}/close`, b.token)).status).toBe(200);
    for (let i = 0; i < 8 && (t.db.prepare(`SELECT COUNT(*) AS n FROM settlements WHERE kind = 'refund' AND status = 'confirmed'`).get() as { n: number }).n === 0; i++) await runSettlement(t.deps);
    check('B4', 'refund of 1.10 test USDC to the funding wallet', String(((await tokens(builderAta)) ?? 0n) - builderBefore), ((await tokens(builderAta)) ?? 0n) - builderBefore === 1_100_000n);

    // 7. On-chain refusal: a second execute of the already-executed payout index (preflight skipped).
    const again = await multisig.instructions.vaultTransactionExecute({ connection: conn as unknown as Connection, multisigPda: new PublicKey(acc.multisig), transactionIndex: BigInt(payout.tx_index), member: pocketqa.publicKey });
    const twice = await send({ op: payoutOp, step: `runner:double_execute_refusal (index ${payout.tx_index})` }, [again.instruction], [], true);
    check('B5', 'the Squads program refuses the second execute on chain; tester balance unchanged', { err: twice.err, tester: String(await tokens(testerAta)) }, !!twice.err && ((await tokens(testerAta)) ?? 0n) - (startTesterUsdc ?? 0n) === 1_000_000n);

    // 8. Ledger integers.
    const books = studyEscrowBooks(t.db, study.id, t.clock.now);
    report.books = books;
    check('B6', 'books balanced: funded 2.20 = settled 1.00 + fees 0.10 + refunded 1.10', books, books.ok && books.fundedUnits === 2_200_000 && books.settledUnits === 1_000_000 && books.feesUnits === 100_000 && books.refundedUnits === 1_100_000);
    check('B6', 'the vault on chain holds exactly the fee', String(await tokens(acc.vaultAta)), (await tokens(acc.vaultAta)) === 100_000n);
    const settlements = t.db.prepare(`SELECT kind, status, amount_units, destination FROM settlements WHERE study_id = ? ORDER BY kind`).all(study.id);
    report.settlementsLedger = settlements;

    // 9. Fresh readback of every journaled operation (finalized, slot, fee payer, token deltas).
    const readback = [];
    for (const s of fullSigs) {
      let tx = null;
      for (let i = 0; i < 6 && !tx; i++) {
        tx = await conn.getParsedTransaction(s.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }).catch(() => null);
        if (!tx) await new Promise((r) => setTimeout(r, 3000));
      }
      const st = (await conn.getSignatureStatuses([s.signature], { searchTransactionHistory: true })).value[0];
      const keys = tx?.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()) ?? [];
      const pre = new Map((tx?.meta?.preTokenBalances ?? []).map((x) => [x.accountIndex, x.uiTokenAmount.amount]));
      const deltas = (tx?.meta?.postTokenBalances ?? []).map((x) => ({ account: keys[x.accountIndex], owner: x.owner, mint: x.mint, deltaUnits: (BigInt(x.uiTokenAmount.amount) - BigInt(pre.get(x.accountIndex) ?? '0')).toString() })).filter((x) => x.deltaUnits !== '0');
      readback.push({ seq: s.seq, op: s.op, step: s.step, ...pub(s.signature), confirmation: st?.confirmationStatus ?? 'not found', slot: tx?.slot ?? null, feePayer: keys[0] ?? null, feeLamports: tx?.meta?.fee ?? null, err: tx?.meta?.err ?? null, tokenDeltas: deltas });
    }
    report.readback = readback;
    check('B7', 'every journaled send is finalized; only the deliberate refusal failed', readback.map((r) => `${r.seq}:${r.confirmation}:${r.err ? 'err' : 'ok'}`), readback.every((r) => r.confirmation === 'finalized') && readback.filter((r) => r.err).length === 1 && !!readback.find((r) => r.err)?.step.includes('double_execute'));
    check('B7', 'fee payer of every send is the Pocket QA test key', [...new Set(readback.map((r) => r.feePayer))], readback.every((r) => r.feePayer === pocketqa.publicKey.toBase58()));
    const usdc = readback.flatMap((r) => r.tokenDeltas.filter((x) => x.mint === PILOT_MINT).map((x) => ({ step: r.step, owner: x.owner, delta: x.deltaUnits })));
    report.tokenMovements = usdc;
    const sum = (owner: string) => usdc.filter((x) => x.owner === owner).reduce((s, x) => s + BigInt(x.delta), 0n);
    check('B7', 'chain token deltas equal the ledger integers (builder -2.20 +1.10, tester +1.00, vault +0.10 net)', { builder: sum(builder.publicKey.toBase58()), tester: sum(tester.publicKey.toBase58()), vault: sum(acc.vaultAuthority) }, sum(builder.publicKey.toBase58()) === -1_100_000n && sum(tester.publicKey.toBase58()) === 1_000_000n && sum(acc.vaultAuthority) === 100_000n);

    // 10. Bounds held.
    const end = await conn.getBalance(pocketqa.publicKey, 'finalized');
    const fees = readback.reduce((s, r) => s + (r.feeLamports ?? 0), 0);
    report.costs = { pocketqaStartLamports: conn.startLamports, pocketqaEndLamports: end, spentLamports: conn.startLamports - end, feesLamports: fees, rentLamports: conn.startLamports - end - fees, sends: seq, fundedUnits: String(f.amountUnits) };
    check('B8', 'within bounds: funding <= 3.00 test USDC; devnet SOL spent (fees + rent) <= 0.05 SOL', report.costs, BigInt(f.amountUnits) <= MAX_FUNDING_UNITS && conn.startLamports - end <= MAX_SPEND_LAMPORTS);
    report.outcome = 'complete';
  });
});
