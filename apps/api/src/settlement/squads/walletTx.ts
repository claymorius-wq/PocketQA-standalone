import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import type { UnsignedTx } from './devnetTypes';
import { PILOT_DECIMALS, PILOT_MINT } from './pins';

/**
 * The two transactions the builder's WALLET signs, built without any network (the blockhash and
 * its last valid height are passed in), so RpcDevnetChain and the test FakeDevnetChain produce the
 * same bytes. They must pass the client's exact templates (@pocket-qa/domain devnetTemplates.ts,
 * pqa-qa P2-CS1; contract test in test/devnet-wallet-tx.test.ts): v0, the wallet is the fee payer
 * and the only signer, unsigned, no lookup tables, no other instruction.
 */
export type Blockhash = { recentBlockhash: string; lastValidBlockHeight: number };

const MINT = new PublicKey(PILOT_MINT);

function unsigned(payer: PublicKey, ixs: TransactionInstruction[], b: Blockhash): UnsignedTx {
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: b.recentBlockhash, instructions: ixs }).compileToV0Message());
  return { messageB64: Buffer.from(tx.message.serialize()).toString('base64'), wireB64: Buffer.from(tx.serialize()).toString('base64'), lastValidBlockHeight: b.lastValidBlockHeight };
}

/** Escrow funding: one TransferChecked of the pinned mint from `from`'s token account to `vaultAta`, `reference` as its 5th account. */
export function buildFundingTx(input: { from: string; vaultAta: string; amount: bigint; reference: string } & Blockhash): UnsignedTx {
  const from = new PublicKey(input.from);
  const ix = createTransferCheckedInstruction(getAssociatedTokenAddressSync(MINT, from, true), MINT, new PublicKey(input.vaultAta), from, input.amount, PILOT_DECIMALS, [], TOKEN_PROGRAM_ID);
  // Solana Pay: the reference is the 5th account of the TransferChecked, read-only, not a signer.
  ix.keys.push({ pubkey: new PublicKey(input.reference), isSigner: false, isWritable: false });
  return unsigned(from, [ix], input);
}

/** The builder's vote: one Squads v4 proposal_approve of (multisig, index) by `member` (memo None). */
export function buildApproveTx(input: { multisig: string; index: bigint; member: string } & Blockhash): UnsignedTx {
  const m = new PublicKey(input.member);
  return unsigned(m, [multisig.instructions.proposalApprove({ multisigPda: new PublicKey(input.multisig), transactionIndex: input.index, member: m })], input);
}
