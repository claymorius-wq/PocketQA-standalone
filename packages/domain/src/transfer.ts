import { SOLANA_DEVNET_GENESIS_HASH } from '@pocket-qa/contracts';
import { DomainError } from './errors';

/** Server-owned expectation, fixed when the intent was created. Nothing here comes from the client. */
export type TransferExpectation = {
  sender: string;
  recipient: string;
  lamports: number;
  signature: string;
  createdAtMs: number;
  expiresAtMs: number;
};

/** Subset of `getTransaction(sig, {encoding:'jsonParsed'})` that verification reads. */
export type ParsedTx = {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown } | null;
  transaction: {
    signatures: string[];
    message: { instructions: { program?: string; parsed?: unknown }[] };
  };
};

export type TransferVerdict = { status: 'pending' | 'confirmed' | 'failed' | 'expired'; reason: string | null };

// Allow small clock skew between this machine and the cluster.
const CLOCK_SKEW_MS = 120_000;

type ParsedTransfer = { type: string; info: { source: string; destination: string; lamports: number } };
function isSystemTransfer(ix: { program?: string; parsed?: unknown }): ix is { program: 'system'; parsed: ParsedTransfer } {
  const p = ix.parsed as ParsedTransfer | undefined;
  return ix.program === 'system' && typeof p === 'object' && p !== null && p.type === 'transfer';
}

/**
 * Pure verification of a claimed devnet transfer. `confirmed` only when the chain shows
 * a successful system transfer of exactly the expected sender, recipient and amount,
 * in a block no older than the intent, on the devnet genesis.
 */
export function verifyTransfer(input: {
  expected: TransferExpectation;
  tx: ParsedTx | null;
  genesisHash: string;
  nowMs: number;
}): TransferVerdict {
  const { expected, tx } = input;
  if (input.genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new DomainError('CHAIN_UNAVAILABLE', 'The configured RPC is not Solana devnet.');
  }
  if (!tx || tx.blockTime === null) {
    if (input.nowMs > expected.expiresAtMs) return { status: 'expired', reason: 'No matching transaction appeared before the intent expired.' };
    return { status: 'pending', reason: null };
  }
  if (tx.transaction.signatures[0] !== expected.signature) return { status: 'failed', reason: 'Signature does not match the transaction.' };
  if (tx.meta?.err) return { status: 'failed', reason: 'The transaction failed on chain.' };
  if (tx.blockTime * 1000 < expected.createdAtMs - CLOCK_SKEW_MS) {
    return { status: 'failed', reason: 'The transaction predates this transfer request.' };
  }
  const match = tx.transaction.message.instructions.some(
    (ix) =>
      isSystemTransfer(ix) &&
      ix.parsed.info.source === expected.sender &&
      ix.parsed.info.destination === expected.recipient &&
      ix.parsed.info.lamports === expected.lamports,
  );
  if (!match) return { status: 'failed', reason: 'No system transfer with the expected sender, recipient and amount.' };
  return { status: 'confirmed', reason: null };
}
