import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config';
import { DEVNET_GENESIS, SQUADS_PROGRAM_DATA } from '../src/settlement/squads/pins';
import { DEVNET_RPC, loadPilotKeys } from '../src/settlement/squads/rpcChain';

/**
 * LIVE completion of Squads devnet pilot run 1 (ADR 0007 §10): ONE targeted send against run 1's
 * EXISTING multisig, never a new lifecycle. It sends a second execute of the already-executed
 * index 1 (preflight skipped, so the program's own refusal lands as evidence) and checks that
 * nothing moved.
 *
 * Skipped unless POCKETQA_LIVE_SQUADS_RUN1_COMPLETE=1 and POCKETQA_LIVE_SQUADS_KEYS_DIR are set.
 *
 * Before signing it checks: devnet genesis; program data equal to the run 1 readback; the
 * multisig config; proposal 1 Executed; the balances it will compare afterwards.
 *
 * An outcome it can't verify as finalized is recorded as unknown, and the test stops: it never
 * retries a send. The public-only receipt goes to docs/reviews/wallet-rewards/devnet-pilot-run1-completion.{json,md}.
 */
const LIVE = process.env.POCKETQA_LIVE_SQUADS_RUN1_COMPLETE === '1';
const DIR = join(REPO_ROOT, 'docs/reviews/wallet-rewards');
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

it.skipIf(!LIVE)('run 1 completion: a second execute of executed index 1 is refused on chain and moves nothing', { timeout: 10 * 60_000 }, async () => {
  const run1 = JSON.parse(readFileSync(join(DIR, 'devnet-pilot-receipt-run1.json'), 'utf8')) as { accounts: Record<string, string>; roles: Record<string, string> };
  const before = JSON.parse(readFileSync(join(DIR, 'devnet-pilot-run1-readback.json'), 'utf8')) as { program: Record<string, unknown> };
  const { signers } = loadPilotKeys(process.env.POCKETQA_LIVE_SQUADS_KEYS_DIR ?? '');
  const pocketqa = signers.pocketqa;
  const conn = new Connection(DEVNET_RPC, 'finalized');
  const pace = () => new Promise((r) => setTimeout(r, 400));
  const out = {
    what: 'Run 1 completion: a second execute of the already-executed Squads index 1 on run 1’s multisig (expected on-chain refusal).',
    disclosure: 'Devnet test USDC, no value. Pilot: test keys simulate all roles; not independent custody; no physical wallet.',
    commit: '',
    at: new Date().toISOString(),
    preChecks: {} as Record<string, unknown>,
    send: null as null | { signature: string; slot: number | null; confirmation: string; err: unknown; feeLamports: number | null; explorer: string },
    postChecks: {} as Record<string, unknown>,
    outcome: 'incomplete' as 'incomplete' | 'refused-as-expected' | 'NOT-refused' | 'unknown',
  };
  const write = () => {
    writeFileSync(join(DIR, 'devnet-pilot-run1-completion.json'), `${JSON.stringify(out, null, 2)}\n`);
    writeFileSync(
      join(DIR, 'devnet-pilot-run1-completion.md'),
      [
        '# Squads devnet pilot: run 1 completion',
        '',
        `> ${out.disclosure}`,
        '',
        `Outcome: **${out.outcome}**. ${out.what} Commit \`${out.commit}\`, ${out.at}.`,
        '',
        out.send ? `Send: [${out.send.signature.slice(0, 12)}…](${out.send.explorer}), slot ${out.send.slot}, ${out.send.confirmation}, err \`${JSON.stringify(out.send.err)}\`, fee ${out.send.feeLamports} lamports.` : 'Nothing was sent.',
        '',
        '```json',
        JSON.stringify({ preChecks: out.preChecks, postChecks: out.postChecks }, null, 2),
        '```',
        '',
      ].join('\n'),
    );
  };
  try {
    const { execSync } = await import('node:child_process');
    out.commit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim();
    const ms = new PublicKey(run1.accounts.multisig!);
    const tokens = async (a: string) => (await pace(), (await conn.getTokenAccountBalance(new PublicKey(a), 'finalized')).value.amount);
    const programNow = async () => {
      await pace();
      const d = (await conn.getAccountInfo(new PublicKey(SQUADS_PROGRAM_DATA), 'finalized'))!.data;
      return { lastDeploySlot: Number(d.readBigUInt64LE(4)), accountSha256: createHash('sha256').update(d).digest('hex') };
    };

    // Pre-checks: everything this one send relies on, read immediately before signing.
    await pace();
    out.preChecks.genesis = await conn.getGenesisHash();
    expect(out.preChecks.genesis).toBe(DEVNET_GENESIS);
    out.preChecks.program = await programNow();
    expect(out.preChecks.program).toEqual({ lastDeploySlot: before.program.lastDeploySlot, accountSha256: before.program.accountSha256 });
    await pace();
    const m = await multisig.accounts.Multisig.fromAccountAddress(conn, ms, 'finalized');
    out.preChecks.multisig = { threshold: m.threshold, timeLock: m.timeLock, configAuthority: m.configAuthority.toBase58(), rentCollector: m.rentCollector ? m.rentCollector.toBase58() : null };
    expect(out.preChecks.multisig).toEqual({ threshold: 2, timeLock: 0, configAuthority: '11111111111111111111111111111111', rentCollector: null });
    await pace();
    const [p1] = multisig.getProposalPda({ multisigPda: ms, transactionIndex: 1n });
    out.preChecks.proposal1 = (await multisig.accounts.Proposal.fromAccountAddress(conn, p1, 'finalized')).status.__kind;
    expect(out.preChecks.proposal1).toBe('Executed');
    out.preChecks.balances = { testerA: await tokens(run1.accounts.testerAUsdcAta!), vault: await tokens(run1.accounts.vaultUsdcAta!) };
    expect(out.preChecks.balances).toEqual({ testerA: '1000000', vault: '210000' });

    // The one send: preflight skipped so the program's own refusal is recorded on chain.
    await pace();
    const { instruction } = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: ms, transactionIndex: 1n, member: pocketqa.publicKey });
    await pace();
    expect(await conn.getGenesisHash()).toBe(DEVNET_GENESIS);
    const { blockhash } = await conn.getLatestBlockhash('finalized');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: pocketqa.publicKey, recentBlockhash: blockhash, instructions: [instruction] }).compileToV0Message());
    tx.sign([pocketqa]);
    const signature = await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 });
    // Finalized status read directly (paced, bounded), never inferred from a confirm rejection.
    let st = null;
    for (let i = 0; i < 45 && st?.confirmationStatus !== 'finalized'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    }
    await pace();
    const landed = st?.confirmationStatus === 'finalized' ? await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }) : null;
    out.send = { signature, slot: st?.slot ?? null, confirmation: st?.confirmationStatus ?? 'not found', err: st?.err ?? null, feeLamports: landed?.meta?.fee ?? null, explorer: explorer(signature) };
    if (st?.confirmationStatus !== 'finalized') {
      out.outcome = 'unknown';
      throw new Error(`outcome unknown: not finalized within 90 s (${signature}); inspect the chain, never retry blindly`);
    }
    out.outcome = st.err ? 'refused-as-expected' : 'NOT-refused';

    // Post-checks: nothing moved, the program is unchanged.
    out.postChecks.balances = { testerA: await tokens(run1.accounts.testerAUsdcAta!), vault: await tokens(run1.accounts.vaultUsdcAta!) };
    out.postChecks.program = await programNow();
    expect(out.outcome).toBe('refused-as-expected');
    expect(out.postChecks.balances).toEqual(out.preChecks.balances);
    expect(out.postChecks.program).toEqual(out.preChecks.program);
  } finally {
    write();
  }
});
