import { base64 } from '@scure/base';
import { bytesEqual } from '@pocket-qa/domain';

/**
 * Normalizes a signMessages result: some wallets return the bare 64-byte signature
 * (Solana Mobile's mock wallet does), others the message with the signature appended.
 */
export function extractSignature(signed: Uint8Array, message: Uint8Array): Uint8Array {
  if (signed.length === 64) return signed;
  if (signed.length === message.length + 64 && bytesEqual(signed.subarray(0, message.length), message)) return signed.subarray(message.length);
  throw new Error('The wallet returned an unexpected signature format.');
}

/**
 * Wallets differ in base64 flavor: some omit `=` padding or use the URL-safe alphabet
 * (observed with Solana Mobile's mock wallet). Normalize before strict decoding.
 */
export function decodeWalletBase64(value: string): Uint8Array {
  const std = value.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(std) || std.length % 4 === 1) throw new Error('The wallet returned malformed data.');
  return base64.decode(std + '='.repeat((4 - (std.length % 4)) % 4));
}
