import { base58 } from '@scure/base';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { decodeVaultTransaction, squadsTransactionPda, verifyVaultTransfer } from '@pocket-qa/domain';
import type { MultisigState, ProposalState } from './chain';
import { DEVNET_GENESIS, PERM, SQUADS_PROGRAM } from './pins';
import { buildApproveTx } from './walletTx';

/**
 * The ARBITER's vote (POCKETQA_ENV=devnet; devnet-phase-contract.md §2): operator-only, never a route.
 * Used for a payment whose cosigner is the arbiter (a dispute overturned in the tester's favour, or
 * a builder who can no longer sign). The operator passes the payment as Pocket QA describes it
 * (multisig, index, op id, recipient, amount: from the admin payout view); this reads the Squads
 * vault transaction on devnet ITSELF and refuses unless it is exactly that payment, created by the
 * pinned platform key, on devnet, with an Active proposal the arbiter is a voting member of. Only
 * then, and only with `send`, does the arbiter's key sign the one proposal_approve. The platform
 * signer completes the 2-of-3 afterwards (the server's settle run). The key is never printed.
 */
/**
 * E-29: the arbiter key pays its own vote's fee. A "dry run OK" must mean the send can succeed, so
 * both the dry run and --send refuse below one signature's fee (5,000 lamports) plus a margin.
 */
export const VOTE_FEE_LAMPORTS = 5_000;
export const ARBITER_MIN_LAMPORTS = VOTE_FEE_LAMPORTS * 2;

export type ArbiterPlan = { multisig: string; txIndex: number; opId: string; recipient: string; amountUnits: number };

/** What the arbiter reads and sends (RPC in production, the fake chain in tests). */
export interface ArbiterChain {
  genesisHash(): Promise<string>;
  /** A wallet's SOL balance in lamports (finalized). */
  balance(address: string): Promise<number>;
  /** The raw account at `address`: its owning program and data, or null. */
  account(address: string): Promise<{ owner: string; data: Uint8Array } | null>;
  getProposal(multisig: string, index: bigint): Promise<ProposalState | null>;
  getMultisig(multisig: string): Promise<MultisigState | null>;
  blockhash(): Promise<{ recentBlockhash: string; lastValidBlockHeight: number }>;
  /** Sends a signed transaction; returns its signature. */
  send(signedWireB64: string): Promise<string>;
}

export class ArbiterRefusal extends Error {}

export async function arbiterApprove(o: { chain: ArbiterChain; arbiter: Keypair; arbiterPubkey: string; platform: string; plan: ArbiterPlan; send: boolean }) {
  const { chain, plan } = o;
  const me = o.arbiter.publicKey.toBase58();
  const refuse = (why: string) => new ArbiterRefusal(`Refused, nothing signed: ${why}`);
  // pqa-qa P3-A1: the loaded key must be the pinned arbiter (POCKETQA_DEVNET_ARBITER_PUBKEY), and never
  // the platform key: otherwise the server's key could cast the second vote a 2-of-3 needs.
  if (me === o.platform) throw refuse('the key file is the platform key; the arbiter vote is never cast with the server key.');
  if (me !== o.arbiterPubkey) throw refuse('the key file is not the pinned --arbiter public key.');
  if ((await chain.genesisHash()) !== DEVNET_GENESIS) throw refuse('the RPC is not Solana devnet (genesis hash mismatch).');
  const acc = await chain.account(squadsTransactionPda(plan.multisig, BigInt(plan.txIndex)));
  if (!acc) throw refuse(`no Squads vault transaction at index ${plan.txIndex} of this multisig.`);
  if (acc.owner !== SQUADS_PROGRAM) throw refuse('that account is not owned by the Squads program.');
  const vt = decodeVaultTransaction(acc.data);
  if (vt.creator !== o.platform) throw refuse('the vault transaction was not created by the pinned Pocket QA platform key.');
  let checked: ReturnType<typeof verifyVaultTransfer>;
  try {
    checked = verifyVaultTransfer(vt, plan);
  } catch (e) {
    throw refuse((e as Error).message);
  }
  const ms = await chain.getMultisig(plan.multisig);
  if (!ms?.members.some((m) => m.key === me && (m.mask & PERM.vote) !== 0)) throw refuse('this key is not a voting member (the arbiter) of the study multisig.');
  const proposal = await chain.getProposal(plan.multisig, BigInt(plan.txIndex));
  if (!proposal) throw refuse('the proposal does not exist yet (Pocket QA creates it first).');
  if (proposal.approved.includes(me)) return { checked, alreadyApproved: true as const, signature: null };
  if (proposal.status !== 'Active') throw refuse(`the proposal is ${proposal.status.toLowerCase()}, not active.`);
  const funds = await chain.balance(me);
  if (funds < ARBITER_MIN_LAMPORTS) {
    throw refuse(`the arbiter key holds ${funds} lamports; its vote's fee needs at least ${ARBITER_MIN_LAMPORTS} (devnet SOL: fund the arbiter key first).`);
  }
  if (!o.send) return { checked, alreadyApproved: false as const, signature: null };
  const unsigned = buildApproveTx({ multisig: plan.multisig, index: BigInt(plan.txIndex), member: me, ...(await chain.blockhash()) });
  const tx = VersionedTransaction.deserialize(Buffer.from(unsigned.wireB64, 'base64'));
  tx.sign([o.arbiter]);
  const signature = await chain.send(Buffer.from(tx.serialize()).toString('base64'));
  return { checked, alreadyApproved: false as const, signature };
}

/** The arbiter's view of devnet over one Connection (reads at finalized). */
export function rpcArbiterChain(rpcUrl: string): ArbiterChain {
  const conn = new Connection(rpcUrl, 'finalized');
  return {
    genesisHash: () => conn.getGenesisHash(),
    balance: (address) => conn.getBalance(new PublicKey(address), 'finalized'),
    async account(address) {
      const info = await conn.getAccountInfo(new PublicKey(address), 'finalized');
      return info ? { owner: info.owner.toBase58(), data: new Uint8Array(info.data) } : null;
    },
    async getProposal(ms, index) {
      const [pda] = multisig.getProposalPda({ multisigPda: new PublicKey(ms), transactionIndex: index });
      const info = await conn.getAccountInfo(pda, 'finalized');
      if (!info) return null;
      const [p] = multisig.accounts.Proposal.fromAccountInfo(info);
      return { status: p.status.__kind as ProposalState['status'], approved: p.approved.map((k) => k.toBase58()) };
    },
    async getMultisig(ms) {
      const info = await conn.getAccountInfo(new PublicKey(ms), 'finalized');
      if (!info) return null;
      const [m] = multisig.accounts.Multisig.fromAccountInfo(info);
      return {
        createKey: m.createKey.toBase58(),
        configAuthority: m.configAuthority.toBase58(),
        threshold: m.threshold,
        timeLock: m.timeLock,
        transactionIndex: BigInt(m.transactionIndex.toString()),
        rentCollector: m.rentCollector ? m.rentCollector.toBase58() : null,
        members: m.members.map((x) => ({ key: x.key.toBase58(), mask: x.permissions.mask })),
      };
    },
    async blockhash() {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
      return { recentBlockhash: blockhash, lastValidBlockHeight };
    },
    async send(signedWireB64) {
      const bytes = Buffer.from(signedWireB64, 'base64');
      await conn.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: 'confirmed' });
      return base58.encode(VersionedTransaction.deserialize(bytes).signatures[0]!);
    },
  };
}
