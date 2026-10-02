import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, type SiwsInput } from '@pocket-qa/contracts';
import { DomainError } from './errors';
import { bytesEqual, utf8Bytes } from './utf8';

export type NonceRecord = {
  userId: string;
  address: string;
  nonce: string;
  input: SiwsInput;
  expiresAtMs: number;
  usedAtMs: number | null;
};

const invalid = (why: string) => new DomainError('NONCE_INVALID', why);

/**
 * Verifies a wallet-link attempt against the server's own nonce record. The signed bytes
 * must equal the SIWS text rebuilt from that record, so domain, address, chain, nonce and
 * timestamps can't be substituted by the client. The caller must mark the nonce used in
 * the same DB transaction as the link (single use), whatever the outcome.
 */
export function verifyWalletLink(input: {
  record: NonceRecord | null;
  request: { userId: string; address: string; nonce: string; signedMessage: Uint8Array; signature: Uint8Array };
  nowMs: number;
}): { address: string } {
  const { record, request } = input;
  if (!record) throw invalid('Nonce is unknown.');
  if (record.usedAtMs !== null) throw invalid('Nonce was already used.');
  if (input.nowMs >= record.expiresAtMs) throw invalid('Nonce has expired.');
  if (record.userId !== request.userId) throw invalid('Nonce belongs to a different account.');
  if (record.nonce !== request.nonce) throw invalid('Nonce does not match.');
  if (record.address !== request.address) throw invalid('Wallet address does not match the nonce.');

  const expected = utf8Bytes(buildSiwsMessage(record.input));
  if (!bytesEqual(expected, request.signedMessage)) throw invalid('Signed message does not match the issued sign-in message.');

  let publicKey: Uint8Array;
  try {
    publicKey = base58.decode(request.address);
  } catch {
    throw invalid('Wallet address is not valid base58.');
  }
  if (publicKey.length !== 32) throw invalid('Wallet address is not a 32-byte public key.');
  if (request.signature.length !== 64) throw invalid('Wallet signature is malformed.');
  let ok: boolean;
  try {
    ok = ed25519.verify(request.signature, request.signedMessage, publicKey);
  } catch {
    ok = false;
  }
  if (!ok) throw invalid('Wallet signature is invalid.');
  return { address: request.address };
}
