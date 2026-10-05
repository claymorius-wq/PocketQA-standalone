import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { base58 } from '@scure/base';
import { afterAll, describe, expect, it } from 'vitest';
import { Study } from '@pocket-qa/contracts';
import { REPO_ROOT } from '../src/config';
import { studyEscrowBooks } from '../src/escrow';
import { operationId, SquadsDevnetSettlement } from '../src/settlement/squads/adapter';
import { DEVNET_GENESIS, PILOT_MINT, SQUADS_PROGRAM, SQUADS_PROGRAM_DATA } from '../src/settlement/squads/pins';
import { DEVNET_RPC, loadPilotKeys, RpcSquadsChain, type SentStep } from '../src/settlement/squads/rpcChain';
import { SettlementFailure } from '../src/settlement/types';
import { runSettlement } from '../src/settlement/worker';
import { DEVICE, makeApp, STUDY, type TestApp } from '../test/helpers';

/**
 * LIVE Squads v4 DEVNET feasibility pilot (ADR 0007 §10). Skipped unless
 * POCKETQA_LIVE_SQUADS_DEVNET=1 and POCKETQA_LIVE_SQUADS_KEYS_DIR names the pilot's test-key
 * directory (outside the repo, 0700, files 0600). Devnet test USDC (no value) and faucet devnet SOL
 * only. Test keys simulate EVERY role (builder, Pocket QA, arbiter, tester): this proves the
 * mechanics, not independent custody, and no physical wallet is involved.
 *
 * It drives the real API, worker and adapter (in-process, temporary database) against the public
 * devnet RPC, then checks the chain directly, and writes a PUBLIC-ONLY receipt (addresses,
 * signatures, slots, statuses, balances, fees; never key material) to
 * docs/reviews/wallet-rewards/devnet-pilot-receipt.{json,md}.
 */
const LIVE = process.env.POCKETQA_LIVE_SQUADS_DEVNET === '1';
const KEYS_DIR = process.env.POCKETQA_LIVE_SQUADS_KEYS_DIR ?? '';
const d = LIVE ? describe : describe.skip;

const USDC = 1_000_000;
const MINT = new PublicKey(PILOT_MINT);
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const account = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

type Step = SentStep & { by: 'adapter' | 'runner'; expectFailure?: boolean; err?: string | null; finalized?: string | null };
const receipt = {
  pilot: 'Squads v4 devnet feasibility pilot (ADR 0007 §10)',
  disclosure: 'Devnet test USDC, no value. Pilot: test keys simulate all roles (builder, Pocket QA, arbiter, tester); not independent custody; no physical wallet; two of three signers.',
  commit: '',
  startedAt: new Date().toISOString(),
  finishedAt: '',
  outcome: 'incomplete' as 'incomplete' | 'complete' | 'failed',
  failure: null as string | null,
  rpc: DEVNET_RPC,
  genesis: '',
  program: { id: SQUADS_PROGRAM, programData: SQUADS_PROGRAM_DATA, before: null as unknown, after: null as unknown },
  roles: {} as Record<string, string>,
  accounts: {} as Record<string, string>,
  multisigOnChain: null as unknown,
  spendingLimits: null as unknown,
  balances: { before: {} as Record<string, string>, after: {} as Record<string, string> },
  steps: [] as Step[],
  checks: [] as { id: string; claim: string; observed: string; ok: boolean }[],
  refusals: [] as { id: string; what: string; result: string; signature: string | null }[],
  alerts: [] as string[],
  books: null as unknown,
  costs: null as unknown,
  commands: [
    'cd apps/api && POCKETQA_LIVE_SQUADS_DEVNET=1 POCKETQA_LIVE_SQUADS_KEYS_DIR=<pilot key dir> npx vitest run --config vitest.live.config.ts test-live/squads-devnet.pilot.live.test.ts',
  ],
};
const check = (id: string, claim: string, observed: unknown, ok: boolean) => {
  receipt.checks.push({ id, claim, observed: typeof observed === 'string' ? observed : JSON.stringify(observed, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), ok });
  expect(ok, `${id}: ${claim}`).toBe(true);
};

function writeReceipt() {
  receipt.finishedAt = new Date().toISOString();
  const dir = join(REPO_ROOT, 'docs/reviews/wallet-rewards');
  const json = JSON.stringify(receipt, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  // Defense in depth: nothing that looks like a 64-byte secret key array or seed ever lands here.
  if (/\[\s*(\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/.test(json)) throw new Error('receipt contains a byte array; refusing to write it');
  writeFileSync(join(dir, 'devnet-pilot-receipt.json'), `${json}\n`);
  const md = [
    '# Squads v4 devnet pilot: receipt',
    '',
    `> ${receipt.disclosure}`,
    '',
    `Outcome: **${receipt.outcome}**${receipt.failure ? ` (${receipt.failure})` : ''}. Commit \`${receipt.commit}\`. ${receipt.startedAt} to ${receipt.finishedAt}. RPC ${receipt.rpc}, genesis \`${receipt.genesis}\`.`,
    '',
    '## Roles and accounts (public keys only)',
    '',
    ...Object.entries({ ...receipt.roles, ...receipt.accounts }).map(([k, v]) => `- ${k}: [\`${v}\`](${account(v)})`),
    '',
    '## Steps (finalized status read back at the end)',
    '',
    '| # | step | by | slot | fee (lamports) | finalized | error | signature |',
    '|---|------|----|------|----------------|-----------|-------|-----------|',
    ...receipt.steps.map((s, i) => `| ${i + 1} | ${s.step}${s.expectFailure ? ' (expected to fail)' : ''} | ${s.by} | ${s.slot} | ${s.feeLamports ?? ''} | ${s.finalized ?? ''} | ${s.err ?? ''} | [${s.signature.slice(0, 10)}…](${explorer(s.signature)}) |`),
    '',
    '## Checks',
    '',
    ...receipt.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.claim}. Observed: \`${c.observed}\``),
    '',
    '## Refusals',
    '',
    ...receipt.refusals.map((r) => `- ${r.id}: ${r.what}: ${r.result}${r.signature ? ` ([tx](${explorer(r.signature)}))` : ' (nothing signed or sent)'}`),
    '',
    '## Alerts raised by the worker',
    '',
    ...(receipt.alerts.length ? receipt.alerts.map((a) => `- ${a}`) : ['- none']),
    '',
    '## Balances (base units; SOL in lamports)',
    '',
    '```json',
    JSON.stringify(receipt.balances, null, 2),
    '```',
    '',
    '## Program before and after',
    '',
    '```json',
    JSON.stringify(receipt.program, null, 2),
    '```',
    '',
    '## Costs',
    '',
    '```json',
    JSON.stringify(receipt.costs, null, 2),
    '```',
    '',
    '## Command',
    '',
    ...receipt.commands.map((c) => `\`${c}\``),
    '',
  ].join('\n');
  writeFileSync(join(dir, 'devnet-pilot-receipt.md'), md);
}

d('LIVE Squads v4 devnet pilot', () => {
  const conn = new Connection(DEVNET_RPC, 'finalized');
  const { signers, createSeed } = LIVE ? loadPilotKeys(KEYS_DIR) : { signers: { builder: Keypair.generate(), pocketqa: Keypair.generate(), arbiter: Keypair.generate() }, createSeed: new Uint8Array(32) };
  // The tester role's test key (same directory and modes, checked by loadPilotKeys above).
  const tester = LIVE ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, 'tester.json'), 'utf8')) as number[])) : Keypair.generate();
  const pocketqa = signers.pocketqa;
  const builder = signers.builder;

  /** The adapter's chain, with a one-shot crash right after an execute lands (R6). */
  class PilotChain extends RpcSquadsChain {
    crashAfterExecute = false;
    override async execute(ms: string, index: bigint) {
      const sig = await super.execute(ms, index);
      if (this.crashAfterExecute) {
        this.crashAfterExecute = false;
        throw new Error(`simulated crash after execute ${index} landed (${sig})`);
      }
      return sig;
    }
  }
  const chain = new PilotChain(conn, signers, (s) => receipt.steps.push({ ...s, by: 'adapter' }));
  let t: TestApp;

  afterAll(async () => {
    try {
      const sigs = receipt.steps.map((s) => s.signature);
      for (let i = 0; i < sigs.length; i += 100) {
        const { value } = await conn.getSignatureStatuses(sigs.slice(i, i + 100), { searchTransactionHistory: true });
        value.forEach((v, j) => {
          const s = receipt.steps[i + j]!;
          s.finalized = v?.confirmationStatus ?? 'not found';
          s.err = v?.err ? JSON.stringify(v.err) : null;
        });
      }
    } finally {
      writeReceipt();
      await t?.close();
    }
  });

  /** Runner-side send (the builder's wallet, or a deliberate refusal); genesis checked before signing. */
  async function send(step: string, ixs: TransactionInstruction[], extra: Keypair[], opts: { expectFailure?: boolean } = {}) {
    expect(await conn.getGenesisHash()).toBe(DEVNET_GENESIS);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: pocketqa.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign([pocketqa, ...extra.filter((k) => !k.publicKey.equals(pocketqa.publicKey))]);
    // A deliberate refusal skips preflight so the program's own rejection lands on chain as evidence.
    const signature = await conn.sendTransaction(tx, { skipPreflight: !!opts.expectFailure, maxRetries: 5 });
    const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'finalized');
    const landed = await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    const err = res.value.err ? JSON.stringify(res.value.err) : null;
    receipt.steps.push({ step, signature, slot: landed?.slot ?? res.context.slot, feeLamports: landed?.meta?.fee ?? null, by: 'runner', expectFailure: opts.expectFailure, err });
    if (!opts.expectFailure && err) throw new Error(`${step} failed: ${err}`);
    return { signature, err, logs: landed?.meta?.logMessages ?? [] };
  }

  async function programState() {
    const info = await conn.getAccountInfo(new PublicKey(SQUADS_PROGRAM_DATA), 'finalized');
    if (!info) return null;
    // UpgradeableLoaderState::ProgramData: tag u32, slot u64, Option<Pubkey>; the program bytes follow at 45.
    const data = info.data;
    const authority = data[12] === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null;
    let end = data.length;
    while (end > 45 && data[end - 1] === 0) end--;
    return {
      lastDeploySlot: Number(data.readBigUInt64LE(4)),
      upgradeAuthority: authority,
      accountDataLength: data.length,
      accountSha256: createHash('sha256').update(data).digest('hex'),
      programBytesTrimmedSha256: createHash('sha256').update(data.subarray(45, end)).digest('hex'),
    };
  }
  const tokens = async (ata: string) => {
    const info = await conn.getAccountInfo(new PublicKey(ata), 'finalized');
    return info ? BigInt((await conn.getTokenAccountBalance(new PublicKey(ata), 'finalized')).value.amount) : null;
  };
  const ata = (owner: PublicKey, mint = MINT) => getAssociatedTokenAddressSync(mint, owner, true).toBase58();

  it('runs funding, payout, dispute, refund, retries and refusals on devnet', { timeout: 60 * 60_000 }, async () => {
    try {
      receipt.commit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim();
      receipt.genesis = await conn.getGenesisHash();
      check('R0', 'the RPC is Solana devnet (genesis pinned)', receipt.genesis, receipt.genesis === DEVNET_GENESIS);
      receipt.program.before = await programState();
      receipt.roles = { builder: builder.publicKey.toBase58(), pocketqa: pocketqa.publicKey.toBase58(), arbiter: signers.arbiter.publicKey.toBase58(), testerA: tester.publicKey.toBase58() };
      const builderAta = ata(builder.publicKey);
      const startLamports = await conn.getBalance(pocketqa.publicKey, 'finalized');
      const startUsdc = await tokens(builderAta);
      receipt.balances.before = { pocketqaLamports: String(startLamports), builderLamports: String(await conn.getBalance(builder.publicKey, 'finalized')), builderUsdcUnits: String(startUsdc ?? 'no token account') };
      // Exact blocker, never a workaround: the run needs faucet devnet SOL and Circle devnet test USDC.
      if (startLamports < 200_000_000 || (startUsdc ?? 0n) < 3_400_000n) {
        throw new Error(`BLOCKED: needs ≥ 0.2 devnet SOL on Pocket QA ${receipt.roles.pocketqa} (has ${startLamports} lamports) and ≥ 3.4 devnet test USDC on builder ${receipt.roles.builder} (has ${startUsdc === null ? 'no token account' : `${startUsdc} units`}). Nothing was sent.`);
      }

      t = await makeApp({ settlement: 'squads_devnet', squadsChain: chain, squadsCreateSeed: createSeed });
      t.clock.now = Date.now();
      const adapter = t.deps.settlement as SquadsDevnetSettlement;

      // Builder: the pilot builder test key linked through the real SIWS flow.
      const b = await t.register('builder');
      expect((await t.linkWallet(b.token, builder.secretKey.slice(0, 32))).address).toBe(receipt.roles.builder);
      const { rewardCredits: _, ...rest } = STUDY;
      const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, title: 'Squads devnet pilot study', slots: 3, payment: { mode: 'escrow', rewardUnits: USDC } })).body);
      const acc = adapter.accountsFor(study.id);
      receipt.accounts = { multisig: acc.multisig, vaultAuthority: acc.vaultAuthority, vaultUsdcAta: acc.vaultAta, builderUsdcAta: builderAta, testerAUsdcAta: ata(tester.publicKey), createKey: acc.createKey };

      // Funding request: creates the multisig and the vault token account on devnet.
      let f = (await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body;
      expect(f).toMatchObject({ settlement: 'squads_devnet', network: 'solana:devnet', vault: acc.vaultAta, amountUnits: 3_300_000 });

      // R1: the multisig as created.
      const ms = await chain.getMultisig(acc.multisig);
      receipt.multisigOnChain = ms;
      check('R1', 'autonomous (no config authority), threshold 2, time lock 0, no rent collector (finished transactions can’t be closed, so operation ids stay on chain)', ms, !!ms && ms.configAuthority === '11111111111111111111111111111111' && ms.threshold === 2 && ms.timeLock === 0 && ms.rentCollector === null);
      const masks = Object.fromEntries((ms?.members ?? []).map((m) => [m.key, m.mask]));
      check('R1', 'members: builder Vote, Pocket QA Initiate+Vote+Execute, arbiter Vote', masks, ms?.members.length === 3 && masks[receipt.roles.builder!] === 2 && masks[receipt.roles.pocketqa!] === 7 && masks[receipt.roles.arbiter!] === 2);
      try {
        const limits = await conn.getProgramAccounts(new PublicKey(SQUADS_PROGRAM), {
          commitment: 'finalized',
          filters: [{ memcmp: { offset: 0, bytes: base58.encode(Uint8Array.from(multisig.generated.spendingLimitDiscriminator)) } }, { memcmp: { offset: 8, bytes: acc.multisig } }],
        });
        receipt.spendingLimits = limits.length;
        check('R1', 'no SpendingLimit account for this multisig', limits.length, limits.length === 0);
      } catch (e) {
        receipt.spendingLimits = `getProgramAccounts refused by the public RPC: ${(e as Error).message}`;
      }

      // R8: a wrong-mint "funding" (wrapped devnet SOL to a vault-owned token account) is refused.
      const vaultWsol = ata(new PublicKey(acc.vaultAuthority), NATIVE_MINT);
      const builderWsol = ata(builder.publicKey, NATIVE_MINT);
      await send('runner:wrong_mint_setup (wrap 0.01 devnet SOL; vault-owned wSOL account)', [
        createAssociatedTokenAccountIdempotentInstruction(pocketqa.publicKey, new PublicKey(builderWsol), builder.publicKey, NATIVE_MINT),
        createAssociatedTokenAccountIdempotentInstruction(pocketqa.publicKey, new PublicKey(vaultWsol), new PublicKey(acc.vaultAuthority), NATIVE_MINT),
        SystemProgram.transfer({ fromPubkey: pocketqa.publicKey, toPubkey: new PublicKey(builderWsol), lamports: 10_000_000 }),
        createSyncNativeInstruction(new PublicKey(builderWsol)),
      ], []);
      const wrongMint = createTransferCheckedInstruction(new PublicKey(builderWsol), NATIVE_MINT, new PublicKey(vaultWsol), builder.publicKey, 3_300_000n, 9);
      wrongMint.keys.push({ pubkey: new PublicKey(f.reference), isSigner: false, isWritable: false });
      const wm = await send('runner:wrong_mint_funding (wSOL with the funding reference)', [wrongMint], [builder]);
      const wmRes = (await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: wm.signature })).body;
      receipt.refusals.push({ id: 'R8', what: 'funding with the right reference and amount but wrapped SOL instead of devnet test USDC', result: `API status ${wmRes.status}: ${wmRes.failureReason}`, signature: wm.signature });
      check('R8', 'a wrong-mint transfer is not credited', wmRes.status, wmRes.status === 'failed');

      // R2: the builder's wallet (test key) funds the exact amount with a fresh reference.
      f = (await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token)).body;
      const vaultBefore = (await tokens(acc.vaultAta)) ?? 0n;
      const fund = createTransferCheckedInstruction(new PublicKey(builderAta), MINT, new PublicKey(acc.vaultAta), builder.publicKey, BigInt(f.amountUnits), 6);
      fund.keys.push({ pubkey: new PublicKey(f.reference), isSigner: false, isWritable: false });
      const funding = await send('runner:funding (builder wallet → study vault, 3.30 devnet test USDC)', [fund], [builder]);
      const fRes = (await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: funding.signature })).body;
      check('R2', 'funding confirmed from the builder wallet, credited exactly once', fRes, fRes.status === 'confirmed' && fRes.source === receipt.roles.builder);
      check('R2', 'vault balance delta equals the quote', String(((await tokens(acc.vaultAta)) ?? 0n) - vaultBefore), ((await tokens(acc.vaultAta)) ?? 0n) - vaultBefore === 3_300_000n);
      expect((await t.req('POST', `/studies/${study.id}/publish`, b.token)).status).toBe(200);

      // Testers: A is the tester test key; B is a fresh devnet address (its key is discarded).
      const join = async (seed?: Uint8Array) => {
        const u = await t.register('tester');
        await t.req('PUT', '/me/device', u.token, DEVICE);
        const w = await t.linkWallet(u.token, seed);
        const p = (await t.req('POST', `/studies/${study.id}/consent`, u.token, { consentVersion: 1, accepted: true, payoutAddress: w.address })).body;
        await t.req('POST', `/participations/${p.id}/start`, u.token);
        await t.req('POST', `/participations/${p.id}/submit`, u.token);
        return { u, pid: p.id as string, wallet: w.address };
      };
      const A = await join(tester.secretKey.slice(0, 32));
      const B = await join(new Uint8Array(randomBytes(32)));
      receipt.roles.testerB = B.wallet;
      receipt.accounts.testerBUsdcAta = ata(new PublicKey(B.wallet));
      await t.req('POST', `/participations/${A.pid}/approve`, b.token, { helpful: true });
      await t.req('POST', `/participations/${B.pid}/reject`, b.token, { reason: 'The recording does not show the tasks.' });
      const dispute = (await t.req('POST', '/disputes', B.u.token, { participationId: B.pid, reason: 'I recorded every task as asked.' })).body;
      const admin = await t.admin();
      await t.req('POST', `/admin/disputes/${dispute.id}/resolve`, admin.token, { outcome: 'overturned', note: 'Evidence shows the tasks.' });

      // R3/R4/R6: payouts, with a crash right after the first execute landed, then two more runs.
      chain.crashAfterExecute = true;
      await expect(runSettlement(t.deps)).rejects.toThrow(/simulated crash after execute/);
      // And the local index mapping is lost, as a restore from an older backup would leave it:
      // recovery must find the payment on chain by its operation id alone.
      t.db.prepare('DELETE FROM squads_attempts').run();
      t.db.prepare(`UPDATE settlements SET status = 'pending', attempt_key = NULL WHERE status = 'submitted' AND signature IS NULL`).run();
      for (let i = 0; i < 2; i++) receipt.alerts.push(...(await runSettlement(t.deps)).alerts);
      for (let i = 0; i < 20 && (t.db.prepare(`SELECT COUNT(*) AS n FROM settlements WHERE status != 'confirmed'`).get() as { n: number }).n > 0; i++) {
        receipt.alerts.push(...(await runSettlement(t.deps)).alerts);
      }
      const payouts = t.db.prepare(`SELECT s.id, s.destination, s.cosigner, s.status, s.signature, a.tx_index FROM settlements s JOIN squads_attempts a ON a.settlement_id = s.id WHERE kind = 'payout' ORDER BY a.tx_index`).all() as { id: string; destination: string; cosigner: string; status: string; signature: string; tx_index: number }[];
      check('R3', 'both payouts confirmed; the overturned dispute co-signed by the arbiter', payouts.map((p) => `${p.tx_index}:${p.cosigner}:${p.status}`), payouts.length === 2 && payouts.every((p) => p.status === 'confirmed') && payouts.some((p) => p.destination === B.wallet && p.cosigner === 'arbiter'));
      for (const p of payouts) {
        const part = t.db.prepare('SELECT participation_id FROM settlements WHERE id = ?').get(p.id) as { participation_id: string };
        const vt = await chain.getVaultTransfer(acc.multisig, BigInt(p.tx_index));
        check('P1-1', `index ${p.tx_index}: the stored vault message is [TransferChecked, Memo(operation id)] created by Pocket QA`, vt, vt?.instructions === 2 && vt.operation === operationId('payout', study.id, part.participation_id) && vt.creator === receipt.roles.pocketqa);
        const prop = await chain.getProposal(acc.multisig, BigInt(p.tx_index));
        const cos = p.cosigner === 'arbiter' ? receipt.roles.arbiter! : receipt.roles.builder!;
        check('R3', `index ${p.tx_index}: executed with two distinct approvals (Pocket QA and the ${p.cosigner})`, prop, prop?.status === 'Executed' && prop.approved.length === 2 && prop.approved.includes(receipt.roles.pocketqa!) && prop.approved.includes(cos));
        const executes = receipt.steps.filter((s) => s.step === `vault_transaction_execute:${p.tx_index}`);
        check('R6', `index ${p.tx_index}: exactly one execute despite the crash and repeated runs`, executes.length, executes.length === 1);
      }
      check('R6', 'tester A received exactly 1.00 devnet test USDC', String(await tokens(ata(tester.publicKey))), (await tokens(ata(tester.publicKey))) === 1_000_000n);
      check('R4', 'tester B (overturned dispute) received exactly 1.00 devnet test USDC', String(await tokens(ata(new PublicKey(B.wallet)))), (await tokens(ata(new PublicKey(B.wallet)))) === 1_000_000n);

      // R5: close; the unused slot's reward and fee are refunded to the funding wallet.
      const builderBefore = (await tokens(builderAta)) ?? 0n;
      expect((await t.req('POST', `/studies/${study.id}/close`, b.token)).status).toBe(200);
      for (let i = 0; i < 10 && (t.db.prepare(`SELECT COUNT(*) AS n FROM settlements WHERE kind = 'refund' AND status = 'confirmed'`).get() as { n: number }).n === 0; i++) {
        receipt.alerts.push(...(await runSettlement(t.deps)).alerts);
      }
      check('R5', 'refund of 1.10 devnet test USDC to the funding wallet', String(((await tokens(builderAta)) ?? 0n) - builderBefore), ((await tokens(builderAta)) ?? 0n) - builderBefore === 1_100_000n);

      // R7: a stray deposit (no funding request) is alerted, never credited.
      await send('runner:unmatched_deposit (builder → vault, 0.01 devnet test USDC, no reference)', [createTransferCheckedInstruction(new PublicKey(builderAta), MINT, new PublicKey(acc.vaultAta), builder.publicKey, 10_000n, 6)], [builder]);
      const { alerts } = await runSettlement(t.deps);
      receipt.alerts.push(...alerts);
      check('R7', 'the unmatched deposit is alerted', alerts, alerts.some((a) => a.includes('unmatched deposit') && a.includes('10000 units')));
      const books = studyEscrowBooks(t.db, study.id, t.clock.now);
      receipt.books = books;
      check('C8', 'books: funded 3.30, settled 2.00, fees 0.20, refunded 1.10, balanced; the deposit not credited', books, books.ok && books.fundedUnits === 3_300_000 && books.settledUnits === 2_000_000 && books.feesUnits === 200_000 && books.refundedUnits === 1_100_000);
      check('C8', 'the vault on chain holds the fees plus the unmatched deposit', String(await tokens(acc.vaultAta)), (await tokens(acc.vaultAta)) === 210_000n);

      // Off-chain policy refusals: nothing is signed (Pocket QA's latest signature is unchanged).
      const latest = async () => (await conn.getSignaturesForAddress(pocketqa.publicKey, { limit: 1 }, 'finalized'))[0]?.signature;
      const before = await latest();
      const refundRow = t.db.prepare(`SELECT id FROM settlements WHERE kind = 'refund'`).get() as { id: string };
      for (const [id, over] of [
        ['policy-destination', { destination: Keypair.generate().publicKey.toBase58() }],
        ['policy-amount', { amountUnits: 1_100_001 }],
      ] as const) {
        const req = { key: `${refundRow.id}:policy`, settlementId: refundRow.id, kind: 'refund' as const, studyId: study.id, vault: acc.vaultAta, destination: receipt.roles.builder!, amountUnits: 1_100_000, cosigner: 'builder' as const, ...over };
        const err = await adapter.submit(req).then(() => null, (e: unknown) => e);
        receipt.refusals.push({ id, what: `a transfer request that differs from its recorded settlement (${Object.keys(over)[0]})`, result: err instanceof SettlementFailure ? err.message : `NOT REFUSED: ${String(err)}`, signature: null });
        check('C2', `${id}: refused before signing`, err instanceof Error ? err.message : 'no error', err instanceof SettlementFailure);
      }
      check('C2', 'no transaction was signed for the policy refusals', await latest(), (await latest()) === before);

      // On-chain refusals by the program itself (preflight skipped so the rejection lands as evidence).
      const msNow = (await chain.getMultisig(acc.multisig))!;
      const idx = msNow.transactionIndex + 1n;
      await chain.createVaultTransfer({ multisig: acc.multisig, index: idx, vaultAuthority: acc.vaultAuthority, source: acc.vaultAta, destination: ata(tester.publicKey), amount: 1n, operation: operationId('payout', study.id, 'pilot-threshold-refusal-check') });
      await chain.createProposal(acc.multisig, idx);
      await chain.approve(acc.multisig, idx, 'pocketqa');
      const { instruction } = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: new PublicKey(acc.multisig), transactionIndex: idx, member: pocketqa.publicKey });
      const one = await send(`runner:threshold_refusal (execute index ${idx} with one approval)`, [instruction], [], { expectFailure: true });
      receipt.refusals.push({ id: 'threshold', what: `execute of index ${idx} with only Pocket QA’s approval (threshold 2)`, result: one.err ? `rejected by the Squads program: ${one.err}` : 'NOT REJECTED', signature: one.signature });
      check('threshold', 'the program refuses execution below the threshold', one.err, !!one.err);
      const first = payouts[0]!;
      const again = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: new PublicKey(acc.multisig), transactionIndex: BigInt(first.tx_index), member: pocketqa.publicKey });
      const twice = await send(`runner:double_execute_refusal (execute index ${first.tx_index} again)`, [again.instruction], [], { expectFailure: true });
      receipt.refusals.push({ id: 'double-execute', what: `a second execute of the already-executed index ${first.tx_index}`, result: twice.err ? `rejected by the Squads program: ${twice.err}` : 'NOT REJECTED', signature: twice.signature });
      check('R6', 'the program refuses a second execution', twice.err, !!twice.err);
      check('R6', 'tester A still holds exactly 1.00 (no double transfer)', String(await tokens(ata(tester.publicKey))), (await tokens(ata(tester.publicKey))) === 1_000_000n);

      receipt.program.after = await programState();
      check('R0', 'the Squads program data is unchanged during the run', { before: receipt.program.before, after: receipt.program.after }, JSON.stringify(receipt.program.before) === JSON.stringify(receipt.program.after));

      const endLamports = await conn.getBalance(pocketqa.publicKey, 'finalized');
      receipt.balances.after = {
        pocketqaLamports: String(endLamports),
        builderUsdcUnits: String(await tokens(builderAta)),
        vaultUsdcUnits: String(await tokens(acc.vaultAta)),
        testerAUsdcUnits: String(await tokens(ata(tester.publicKey))),
        testerBUsdcUnits: String(await tokens(ata(new PublicKey(B.wallet)))),
        vaultWsolLamports: String((await conn.getBalance(new PublicKey(vaultWsol), 'finalized'))),
      };
      const fees = receipt.steps.reduce((s, x) => s + (x.feeLamports ?? 0), 0);
      receipt.costs = {
        note: 'Devnet SOL (no value), all paid by the Pocket QA test key. Rent is the remainder after fees (account creations; the wrong-mint check also wrapped 0.01 SOL).',
        transactions: receipt.steps.length,
        signaturesFeeLamports: fees,
        pocketqaSpentLamports: startLamports - endLamports,
        rentAndWrappedLamports: startLamports - endLamports - fees,
        signingRounds: 'per payout or refund: create vault transaction, create proposal, two approvals, execute (5 transactions; the token account creation adds one the first time)',
      };
      receipt.outcome = 'complete';
    } catch (e) {
      receipt.outcome = 'failed';
      receipt.failure = (e as Error).message;
      throw e;
    }
  });
});
