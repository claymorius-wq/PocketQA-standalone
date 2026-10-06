import { DomainError } from './errors';
import { associatedTokenAddress, SQUADS_V4_PROGRAM, squadsProposalPda, TOKEN_PROGRAM } from './pda';
import type { DecodedServerTx } from './serverTx';
import { DEVNET_USDC_MINT } from './tokenTransfer';

/**
 * Exact templates for the devnet pilot's server-built transactions (pqa-qa P2-CS1). Every value the
 * client shows is READ FROM THE BYTES here; the server's JSON plan is only compared against it, and
 * any difference refuses. Anything outside the template refuses: other programs, System transfers,
 * SPL Approve / SetAuthority / CloseAccount, extra or duplicate instructions, accounts from lookup
 * tables, a second signer, a filled signature slot.
 */
export const PILOT_MINT = DEVNET_USDC_MINT;
export const PILOT_DECIMALS = 6;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
/** ComputeBudget is allowed only within these fixed bounds (a vote or a transfer needs far less). */
export const CU_LIMIT_MAX = 200_000;
export const CU_PRICE_MAX_MICROLAMPORTS = 100_000;
const TRANSFER_CHECKED = 12;
/** sha256("global:proposal_approve")[0..8], as in @sqds/multisig. */
const PROPOSAL_APPROVE = [144, 37, 164, 136, 188, 216, 42, 248];

const refuse = (why: string) => new DomainError('VALIDATION', `This transaction doesn’t match what Pocket QA asked for: ${why}.`);
type Ix = DecodedServerTx['instructions'][number];

/** The shared envelope: only `signer` signs and pays, unsigned, no lookup tables, bounded ComputeBudget. Returns the rest. */
function envelope(tx: DecodedServerTx, signer: string): Ix[] {
  if (tx.feePayer !== signer) throw refuse('the fee payer is not your linked wallet');
  if (tx.requiredSignatures !== 1) throw refuse('it needs another signer');
  if (tx.signed.some(Boolean)) throw refuse('it is already signed');
  if (tx.lookupTables !== 0) throw refuse('it uses address lookup tables');
  let limit = 0;
  let price = 0;
  const rest: Ix[] = [];
  for (const ix of tx.instructions) {
    if (ix.programId !== COMPUTE_BUDGET) {
      rest.push(ix);
      continue;
    }
    const d = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    if (ix.accounts.length !== 0) throw refuse('a compute budget instruction has accounts');
    if (ix.data[0] === 2 && ix.data.length === 5 && limit++ === 0) {
      if (d.getUint32(1, true) > CU_LIMIT_MAX) throw refuse('the compute limit is over the bound');
    } else if (ix.data[0] === 3 && ix.data.length === 9 && price++ === 0) {
      if (d.getBigUint64(1, true) > BigInt(CU_PRICE_MAX_MICROLAMPORTS)) throw refuse('the compute priority fee is over the bound');
    } else {
      throw refuse('an unexpected compute budget instruction');
    }
  }
  return rest;
}

export function verifyFundingTx(
  tx: DecodedServerTx,
  plan: { owner: string; amountUnits: number; destination: string; reference: string; mint: string },
): { amountUnits: number; destination: string; source: string; mint: string; reference: string } {
  const rest = envelope(tx, plan.owner);
  const transfers = rest.filter((ix) => ix.programId === TOKEN_PROGRAM && ix.data[0] === TRANSFER_CHECKED);
  if (transfers.length !== 1) throw refuse('it must be exactly one TransferChecked of devnet test USDC');
  if (rest.length !== 1) throw refuse(`it has an extra instruction (${rest.find((ix) => ix !== transfers[0])?.programId ?? 'unexpected'})`);
  const t = transfers[0]!;
  if (t.data.length !== 10) throw refuse('the TransferChecked data is malformed');
  const [source, mint, destination, owner, reference, ...more] = t.accounts;
  if (more.length) throw refuse('the TransferChecked has extra accounts');
  const amount = new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength).getBigUint64(1, true);
  const decimals = t.data[9];
  // The bytes against the pins, then against the plan.
  if (mint !== PILOT_MINT) throw refuse('the token mint is not the pinned devnet test USDC mint');
  if (plan.mint !== mint) throw refuse('the plan’s mint differs from the transaction');
  if (decimals !== PILOT_DECIMALS) throw refuse('the decimals are not 6');
  if (owner !== plan.owner) throw refuse('the token owner (signer) is not your linked wallet');
  if (source !== associatedTokenAddress(plan.owner, PILOT_MINT)) throw refuse('the source is not your wallet’s devnet test USDC account');
  if (destination !== plan.destination) throw refuse('the destination differs from the plan');
  if (!reference || reference !== plan.reference) throw refuse('the funding reference is missing or differs from the plan');
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || Number(amount) !== plan.amountUnits) throw refuse('the amount differs from the plan');
  return { amountUnits: Number(amount), destination, source, mint, reference };
}

export function verifyApprovalTx(
  tx: DecodedServerTx,
  plan: { member: string; multisig: string; txIndex: number; opId: string },
): { multisig: string; txIndex: number; proposal: string; member: string } {
  const rest = envelope(tx, plan.member);
  const votes = rest.filter((ix) => ix.programId === SQUADS_V4_PROGRAM);
  const memos = rest.filter((ix) => ix.programId === MEMO_PROGRAM);
  if (votes.length !== 1) throw refuse('it must be exactly one Squads proposal_approve');
  if (memos.length > 1) throw refuse('it has more than one memo');
  if (rest.length !== votes.length + memos.length) throw refuse(`it has an extra instruction (${rest.find((ix) => ix.programId !== SQUADS_V4_PROGRAM && ix.programId !== MEMO_PROGRAM)?.programId})`);
  const v = votes[0]!;
  if (v.data.length < 9 || PROPOSAL_APPROVE.some((b, i) => v.data[i] !== b)) throw refuse('it is not a Squads proposal_approve');
  // ProposalVoteArgs { memo: Option<String> }: None, or exactly the operation id.
  const opt = v.data[8];
  if (opt === 0) {
    if (v.data.length !== 9) throw refuse('the vote has trailing data');
  } else if (opt === 1 && v.data.length >= 13) {
    const len = new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength).getUint32(9, true);
    if (v.data.length !== 13 + len || new TextDecoder().decode(v.data.subarray(13)) !== plan.opId) throw refuse('the vote memo is not this payment’s operation id');
  } else {
    throw refuse('the vote memo is malformed');
  }
  for (const m of memos) {
    if (m.accounts.length || new TextDecoder().decode(m.data) !== plan.opId) throw refuse('the memo is not this payment’s operation id');
  }
  const [multisig, member, proposal, ...more] = v.accounts;
  if (more.length) throw refuse('the vote has extra accounts');
  if (multisig !== plan.multisig) throw refuse('the multisig differs from the plan');
  if (member !== plan.member) throw refuse('the voting member is not your linked wallet');
  if (!Number.isSafeInteger(plan.txIndex) || plan.txIndex < 1 || proposal !== squadsProposalPda(plan.multisig, BigInt(plan.txIndex))) {
    throw refuse('the proposal is not the one for this payment’s transaction index');
  }
  return { multisig, txIndex: plan.txIndex, proposal, member };
}
