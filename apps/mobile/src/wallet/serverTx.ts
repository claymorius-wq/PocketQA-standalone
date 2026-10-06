import { base58 } from '@scure/base';
import { DEVNET_COPY, type DevnetFundingTransaction, type SettlementApproval } from '@pocket-qa/contracts';
import { decodeServerTx, verifyApprovalTx, verifyFundingTx } from '@pocket-qa/domain';
import { tokenAmount } from '../lib/money';
import type { VaultRead } from './devnetRpc';

/**
 * Devnet pilot: transactions the SERVER builds for the builder's wallet to sign and send (escrow
 * funding; the builder's Squads vote on one payment, pqa-be3-interfaces.md §2). Before any wallet
 * opens, the bytes must match an exact template (packages/domain devnetTemplates.ts, pqa-qa P2-CS1)
 * and the server's plan must agree with them. What is shown as checked is READ FROM THE BYTES.
 * A vote's bytes don't contain the payment's amount or destination: they are in the Squads vault
 * transaction, which the client reads on devnet itself (devnetRpc.ts, applyVaultRead). Only a
 * matching read moves them to the checked rows; otherwise they stay described by Pocket QA.
 */
export const DEVNET_PILOT_COPY = DEVNET_COPY;
export const SQUADS_V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

/** What the server returns for a transaction to sign: a vote on one payment, or the escrow funding transfer. */
export type ServerTxPlan = SettlementApproval | DevnetFundingTransaction;
export type SignContext = {
  settlement: string;
  linkedWallet: string | null;
  /** Funding: the vault token account from the funding request (POST /escrow/fundings). Required for a funding (pqa-qa CS2). */
  expectedDestination?: string;
  /**
   * A vote: the payment this screen is approving (the study's refund, the participation's payout).
   * The plan must be that settlement and kind, and its described amount and recipient must agree
   * with what the app already shows; they stay "described" (a vote's bytes can't prove them).
   */
  expectedApproval?: { settlementId: string; kind: SettlementApproval['kind']; amountUnits: number; destination: string | null };
};
export type PlanRow = { label: string; value: string };
export type CheckedPlan = {
  kind: SettlementApproval['kind'] | 'funding';
  /** The wallet that signs and pays the network fee (the linked wallet). */
  signer: string;
  /** Read from the transaction bytes and matched against the template and the plan. */
  checked: PlanRow[];
  /** From Pocket QA's plan, not contained in this transaction (a vote's payment details, until read on devnet). */
  described: PlanRow[];
  /** Why the described rows weren't checked on Solana devnet (devnetRpc.ts), when they weren't. */
  describedNote?: string;
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
  const refuse = (why: string) => new PlanRefused(`${why.replace(/\.$/, '')}. Nothing was signed.`);
  if (ctx.settlement !== 'squads_devnet') throw refuse('Wallet signing is offered only in the devnet pilot');
  // A transaction carries no chain id: the server must say devnet, and the wallet is asked on devnet.
  if (plan.network !== 'devnet') throw refuse('This transaction isn’t for Solana devnet');
  const linked = ctx.linkedWallet;
  if (!linked) throw refuse('Link your devnet wallet first');
  if (!Number.isSafeInteger(plan.amountUnits) || plan.amountUnits <= 0) throw refuse('The amount isn’t a whole number of test-USDC units');
  if (!isAddress(plan.destination) || !isAddress(plan.mint)) throw refuse('The plan’s addresses aren’t Solana addresses');
  try {
    const want = ctx.expectedApproval;
    if (want && ('fundingId' in plan || plan.settlementId !== want.settlementId || plan.kind !== want.kind)) throw refuse('This is not the payment you are approving');
    if (want && plan.amountUnits !== want.amountUnits) throw refuse('The payment’s amount differs from what this screen shows');
    if (want && want.destination !== null && plan.destination !== want.destination) throw refuse('The payment’s recipient differs from what this screen shows');
    const tx = decodeServerTx(plan.transactionB64);
    if ('fundingId' in plan) {
      if (!ctx.expectedDestination) throw refuse('There is no study’s vault to compare the destination with');
      const v = verifyFundingTx(tx, { owner: linked, amountUnits: plan.amountUnits, destination: plan.destination, reference: plan.reference, mint: plan.mint });
      if (v.destination !== ctx.expectedDestination) throw refuse('The destination is not this study’s vault');
      return {
        kind: 'funding',
        signer: linked,
        checked: [
          { label: 'Amount', value: tokenAmount(v.amountUnits, 'squads_devnet') },
          { label: 'To the study vault (token account)', value: v.destination },
          { label: 'From your devnet test USDC account', value: v.source },
          { label: 'Reference', value: v.reference },
          { label: 'Token mint', value: v.mint },
        ],
        described: [],
        copy: DEVNET_COPY,
      };
    }
    if (!/^pqa-op1:[0-9a-f]{64}$/.test(plan.opId)) throw refuse('The operation id isn’t a Pocket QA operation');
    const v = verifyApprovalTx(tx, { member: linked, multisig: plan.multisig, txIndex: plan.txIndex, opId: plan.opId });
    return {
      kind: plan.kind,
      signer: linked,
      checked: [
        { label: 'Vote in multisig', value: v.multisig },
        { label: 'On payment proposal', value: `#${v.txIndex} (${v.proposal})` },
      ],
      described: [
        { label: 'Amount', value: tokenAmount(plan.amountUnits, 'squads_devnet') },
        { label: 'To', value: plan.destination },
        { label: 'Operation id', value: plan.opId },
      ],
      copy: DEVNET_COPY,
    };
  } catch (e) {
    if (e instanceof PlanRefused) throw e;
    throw refuse(e instanceof Error ? e.message : 'This transaction doesn’t match what Pocket QA asked for');
  }
}

/**
 * A vote's plan after the devnet read of the payment it approves (pqa-qa CS3): `checked` moves the
 * amount, recipient and op id to the checked rows (and must agree with the plan), `mismatch`
 * refuses, `unavailable` keeps them described with the reason.
 */
export function applyVaultRead(c: CheckedPlan, plan: SettlementApproval, read: VaultRead): CheckedPlan {
  const refuse = (why: string) => new PlanRefused(`${why.replace(/\.$/, '')}. Nothing was signed.`);
  if (read.state === 'mismatch') throw refuse(read.reason);
  if (read.state === 'unavailable') return { ...c, describedNote: read.reason };
  if (read.amountUnits !== plan.amountUnits || read.recipient !== plan.destination || read.opId !== plan.opId) throw refuse('The payment on Solana devnet doesn’t match what Pocket QA described');
  return {
    ...c,
    checked: [
      ...c.checked,
      { label: 'Amount', value: tokenAmount(read.amountUnits, 'squads_devnet') },
      { label: 'To', value: read.recipient },
      { label: 'Operation id', value: read.opId },
    ],
    described: [],
  };
}
