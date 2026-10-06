import { base58 } from '@scure/base';
import { decodeServerTx } from '@pocket-qa/domain';
import { tokenAmount } from '../lib/money';

/**
 * Devnet pilot: transactions the SERVER builds for the builder's wallet to sign and send (escrow
 * funding; the builder's Squads approval of a payout or refund, pqa-be3-interfaces.md §2). Before
 * any wallet opens, the client checks the server's plan AND the transaction bytes, and returns the
 * plan to show: what it is, how much, to whom, and the operation id. Every refusal happens before
 * the wallet is asked anything, so nothing is signed or sent.
 */
export const DEVNET_PILOT_COPY = 'devnet test USDC, no value · test keys · not independent custody';
export const SQUADS_V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
/** The only programs a server-built pilot transaction may call. */
export const PILOT_PROGRAMS: readonly string[] = [
  SQUADS_V4,
  '11111111111111111111111111111111', // System
  'ComputeBudget111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token (classic)
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo (op id)
];

/** What the server returns for a transaction to sign (approval route; the funding route mirrors it). */
export type ServerTxPlan = {
  transactionB64: string;
  opId: string;
  kind?: string;
  amountUnits: number;
  destination: string;
  network?: string;
  copy?: string;
};
export type SignContext = { settlement: string; linkedWallet: string | null };
export type CheckedPlan = {
  kind: string;
  opId: string;
  amountUnits: number;
  amountText: string;
  destination: string;
  signer: string;
  programs: string[];
  copy: string;
};

export class PlanRefused extends Error {}

const isAddress = (a: unknown) => {
  try {
    return typeof a === 'string' && base58.decode(a).length === 32;
  } catch {
    return false;
  }
};

export function checkServerTxPlan(plan: ServerTxPlan, ctx: SignContext): CheckedPlan {
  const refuse = (why: string) => new PlanRefused(`${why} Nothing was signed.`);
  if (ctx.settlement !== 'squads_devnet') throw refuse('Wallet signing is offered only in the devnet pilot.');
  // A transaction carries no chain id: the server must say devnet, and the wallet is asked on devnet.
  if (plan.network !== 'devnet') throw refuse('This transaction isn’t for Solana devnet.');
  if (!ctx.linkedWallet) throw refuse('Link your devnet wallet first.');
  if (!Number.isSafeInteger(plan.amountUnits) || plan.amountUnits <= 0) throw refuse('The amount isn’t a whole number of test-USDC units.');
  if (!isAddress(plan.destination)) throw refuse('The destination isn’t a Solana address.');
  if (!/^pqa-op1:[0-9a-f]{64}$/.test(plan.opId)) throw refuse('The operation id isn’t a Pocket QA operation.');
  let tx: ReturnType<typeof decodeServerTx>;
  try {
    tx = decodeServerTx(plan.transactionB64);
  } catch (e) {
    throw refuse(e instanceof Error ? e.message : 'Not a valid devnet transaction.');
  }
  if (tx.feePayer !== ctx.linkedWallet) throw refuse('This transaction is not for your linked wallet.');
  if (tx.requiredSignatures !== 1) throw refuse('This transaction needs other signers; only your wallet may sign it.');
  if (tx.signed.some(Boolean)) throw refuse('This transaction is already signed.');
  const unexpected = tx.programIds.filter((p) => !PILOT_PROGRAMS.includes(p));
  if (unexpected.length) throw refuse(`This transaction calls an unexpected program (${unexpected[0]}).`);
  return {
    kind: plan.kind ?? 'transaction',
    opId: plan.opId,
    amountUnits: plan.amountUnits,
    amountText: tokenAmount(plan.amountUnits, 'squads_devnet'),
    destination: plan.destination,
    signer: tx.feePayer,
    programs: tx.programIds,
    copy: DEVNET_PILOT_COPY,
  };
}
