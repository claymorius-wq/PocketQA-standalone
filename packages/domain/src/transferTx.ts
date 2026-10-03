import { base58 } from '@scure/base';
import { DomainError } from './errors';

const SYSTEM_PROGRAM = new Uint8Array(32); // 11111111111111111111111111111111
const TRANSFER_INSTRUCTION = 2; // SystemInstruction::Transfer

function key(address: string, what: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch {
    throw new DomainError('VALIDATION', `${what} is not valid base58.`);
  }
  if (bytes.length !== 32) throw new DomainError('VALIDATION', `${what} must be 32 bytes.`);
  return bytes;
}

// Solana "shortvec" length prefix; every length here is < 128, so it's one byte.
const shortvec = (n: number) => Uint8Array.of(n);

/**
 * Unsigned legacy transaction with one System Program transfer, for the wallet to sign
 * and send (MWA signAndSendTransactions). Built by hand so the bytes are auditable; the
 * layout is pinned by decoding it with @solana/kit in transferTx.test.ts. The server never
 * trusts this: it verifies the finalized on-chain transaction against its own intent.
 */
export function buildDevnetTransferTx(input: { sender: string; recipient: string; lamports: number; blockhash: string }): Uint8Array {
  if (!Number.isInteger(input.lamports) || input.lamports <= 0) throw new DomainError('VALIDATION', 'Amount must be a positive whole number of lamports.');
  if (input.sender === input.recipient) throw new DomainError('VALIDATION', 'Sender and recipient must differ.');
  const from = key(input.sender, 'Sender');
  const to = key(input.recipient, 'Recipient');
  const blockhash = key(input.blockhash, 'Blockhash');

  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, TRANSFER_INSTRUCTION, true);
  view.setBigUint64(4, BigInt(input.lamports), true);

  const message = concat(
    Uint8Array.of(1, 0, 1), // 1 signer (sender, writable); 0 readonly signers; 1 readonly non-signer (system program)
    shortvec(3), from, to, SYSTEM_PROGRAM,
    blockhash,
    shortvec(1), // one instruction
    Uint8Array.of(2), shortvec(2), Uint8Array.of(0, 1), shortvec(data.length), data,
  );
  return concat(shortvec(1), new Uint8Array(64), message); // one empty signature slot
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
