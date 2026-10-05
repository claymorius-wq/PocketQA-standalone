import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { DEVNET_GENESIS, PILOT_MINT, SQUADS_PROGRAM_DATA } from '../src/settlement/squads/pins';
import { DEVNET_RPC } from '../src/settlement/squads/rpcChain';

/**
 * READ-ONLY readback of a Squads devnet pilot run (ADR 0007 §10): no key is loaded and nothing is
 * signed or sent. Given a run's receipt JSON (and any extra signatures read from the chain), it
 * prints, as JSON:
 * - the genesis;
 * - the Squads program-data state;
 * - the multisig config and every proposal;
 * - each signature's finalized status, error and fee (failed transactions included);
 * - the balances of every account the receipt names;
 * - Pocket QA's total lamport spend since the receipt's starting balance.
 * Reads are paced for the shared public RPC.
 *
 * Usage: tsx scripts/squads-pilot-readback.ts <receipt.json> [extraSignature ...]
 */
const [receiptPath, ...extra] = process.argv.slice(2);
if (!receiptPath) throw new Error('usage: squads-pilot-readback.ts <receipt.json> [extraSignature ...]');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
  roles: Record<string, string>;
  accounts: Record<string, string>;
  balances: { before: Record<string, string> };
  steps: { step: string; signature: string }[];
};
const conn = new Connection(DEVNET_RPC, 'finalized');
const pace = () => new Promise((r) => setTimeout(r, 400));
async function read<T>(f: () => Promise<T>): Promise<T> {
  await pace();
  return f();
}

const genesis = await read(() => conn.getGenesisHash());
if (genesis !== DEVNET_GENESIS) throw new Error(`not devnet: ${genesis}`);

const pd = (await read(() => conn.getAccountInfo(new PublicKey(SQUADS_PROGRAM_DATA), 'finalized')))!.data;
let end = pd.length;
while (end > 45 && pd[end - 1] === 0) end--;
const program = {
  lastDeploySlot: Number(pd.readBigUInt64LE(4)),
  upgradeAuthority: pd[12] === 1 ? new PublicKey(pd.subarray(13, 45)).toBase58() : null,
  accountDataLength: pd.length,
  accountSha256: createHash('sha256').update(pd).digest('hex'),
  programBytesTrimmedSha256: createHash('sha256').update(pd.subarray(45, end)).digest('hex'),
};

const msKey = new PublicKey(receipt.accounts.multisig!);
const ms = await read(() => multisig.accounts.Multisig.fromAccountAddress(conn, msKey, 'finalized'));
const txCount = BigInt(ms.transactionIndex.toString());
const proposals: Record<string, unknown>[] = [];
for (let i = 1n; i <= txCount; i++) {
  const [pda] = multisig.getProposalPda({ multisigPda: msKey, transactionIndex: i });
  const p = await read(() => multisig.accounts.Proposal.fromAccountAddress(conn, pda, 'finalized')).catch(() => null);
  proposals.push({ index: Number(i), status: p?.status.__kind ?? 'none', approved: p?.approved.map((k) => k.toBase58()) ?? [] });
}

const sigs = [...receipt.steps.map((s) => ({ step: s.step, signature: s.signature })), ...extra.map((signature) => ({ step: 'extra (chain readback)', signature }))];
const statuses = (await read(() => conn.getSignatureStatuses(sigs.map((s) => s.signature), { searchTransactionHistory: true }))).value;
const transactions = [];
let fees = 0;
for (const [i, s] of sigs.entries()) {
  const tx = await read(() => conn.getTransaction(s.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }));
  fees += tx?.meta?.fee ?? 0;
  transactions.push({ ...s, slot: tx?.slot ?? null, confirmation: statuses[i]?.confirmationStatus ?? 'not found', err: tx?.meta?.err ?? null, feeLamports: tx?.meta?.fee ?? null });
}

const tokens = async (ata: string) => {
  const info = await read(() => conn.getAccountInfo(new PublicKey(ata), 'finalized'));
  return info ? (await read(() => conn.getTokenAccountBalance(new PublicKey(ata), 'finalized'))).value.amount : 'no account';
};
const balances: Record<string, string> = {};
for (const [name, ata] of Object.entries(receipt.accounts)) if (/Ata$/.test(name)) balances[`${name}Units`] = await tokens(ata);
balances.vaultWsolLamports = String(await read(() => conn.getBalance(getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(receipt.accounts.vaultAuthority!), true), 'finalized')));
const pocketqaNow = await read(() => conn.getBalance(new PublicKey(receipt.roles.pocketqa!), 'finalized'));
balances.pocketqaLamports = String(pocketqaNow);
balances.builderLamports = String(await read(() => conn.getBalance(new PublicKey(receipt.roles.builder!), 'finalized')));

const start = Number(receipt.balances.before.pocketqaLamports);
console.log(
  JSON.stringify(
    {
      readAt: new Date().toISOString(),
      rpc: DEVNET_RPC,
      genesis,
      mint: PILOT_MINT,
      program,
      multisig: {
        address: msKey.toBase58(),
        threshold: ms.threshold,
        timeLock: ms.timeLock,
        configAuthority: ms.configAuthority.toBase58(),
        rentCollector: ms.rentCollector ? ms.rentCollector.toBase58() : null,
        transactionIndex: Number(txCount),
        members: ms.members.map((m) => ({ key: m.key.toBase58(), mask: m.permissions.mask })),
      },
      proposals,
      transactions,
      balances,
      costs: {
        note: 'All paid by the Pocket QA test key in devnet SOL (no value); includes failed transactions. Rent is what remains after fees (account creations; the wrong-mint check wrapped 0.01 SOL into a vault-owned account).',
        pocketqaStartLamports: start,
        pocketqaNowLamports: pocketqaNow,
        pocketqaSpentLamports: start - pocketqaNow,
        feesOfListedTransactionsLamports: fees,
        rentAndWrappedLamports: start - pocketqaNow - fees,
      },
    },
    null,
    2,
  ),
);
