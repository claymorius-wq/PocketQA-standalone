import { base58 } from '@scure/base';
import { DEVNET_COPY, type DevnetFundingTransaction, type SettlementApproval } from '@pocket-qa/contracts';
import { decodeServerTx, verifyApprovalTx, verifyFundingTx } from '@pocket-qa/domain';
import { tokenAmount } from '../lib/money';

/**
 * Devnet pilot: transactions the SERVER builds for the builder's wallet to sign and send (escrow
 * funding; the builder's Squads vote on one payment, pqa-be3-interfaces.md §2). Before any wallet
 * opens, the bytes must match an exact template (packages/domain devnetTemplates.ts, pqa-qa P2-CS1)
 * and the server's plan must agree with them. What is shown as checked is READ FROM THE BYTES.
 * A vote's bytes don't contain the payment's amount or destination (they are in the vault
 * transaction already on chain), so those are shown as described by Pocket QA, never as checked.
 */
export const DEVNET_PILOT_COPY = DEVNET_COPY;
export const SQUADS_V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

/** What the server returns for a transaction to sign: a vote on one payment, or the escrow funding transfer. */
export type ServerTxPlan = SettlementApproval | DevnetFundingTransaction;
export type SignContext = {
  settlement: string;
  linkedWallet: string | null;
  /** Funding: the vault token account from the funding request (POST /escrow/fundings), compared too. */
  expectedDestination?: string;
};
export type PlanRow = { label: string; value: string };
export type CheckedPlan = {
  kind: SettlementApproval['kind'] | 'funding';
  /** The wallet that signs and pays the network fee (the linked wallet). */
  signer: string;
  /** Read from the transaction bytes and matched against the template and the plan. */
  checked: PlanRow[];
  /** From Pocket QA's plan, not contained in this transaction (a vote's payment details). */
  described: PlanRow[];
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
    const tx = decodeServerTx(plan.transactionB64);
    if ('fundingId' in plan) {
      const v = verifyFundingTx(tx, { owner: linked, amountUnits: plan.amountUnits, destination: plan.destination, reference: plan.reference, mint: plan.mint });
      if (ctx.expectedDestination !== undefined && v.destination !== ctx.expectedDestination) throw refuse('The destination is not this study’s vault');
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
