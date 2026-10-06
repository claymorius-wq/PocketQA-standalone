import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { Keypair } from '@solana/web3.js';

/**
 * The ONE key the server holds in POCKETQA_ENV=devnet (devnet-phase-contract.md §2, CH-D4): Pocket
 * QA's platform signer. Builder and arbiter keys are never read here: the builder signs in their
 * own wallet and the arbiter only through the operator CLI.
 *
 * Sources: POCKETQA_DEVNET_PLATFORM_SIGNER (Vercel Preview env, server-only, a JSON array of the
 * 64-byte secret key) or POCKETQA_DEVNET_PLATFORM_SIGNER_FILE (local live runs: an absolute path,
 * file 0600 in a 0700 directory). Errors name the variable and never contain its value.
 */
export class SignerError extends Error {}

export function loadPlatformSigner(env: Record<string, string | undefined>): Keypair {
  const file = env.POCKETQA_DEVNET_PLATFORM_SIGNER_FILE;
  let raw: string;
  let name: string;
  if (file) {
    name = 'POCKETQA_DEVNET_PLATFORM_SIGNER_FILE';
    if (!isAbsolute(file)) throw new SignerError(`${name} must be an absolute path.`);
    if ((statSync(dirname(file)).mode & 0o077) !== 0) throw new SignerError(`${name}: the key directory must be mode 0700.`);
    if ((statSync(file).mode & 0o077) !== 0) throw new SignerError(`${name}: the key file must be mode 0600.`);
    raw = readFileSync(file, 'utf8');
  } else {
    name = 'POCKETQA_DEVNET_PLATFORM_SIGNER';
    raw = env.POCKETQA_DEVNET_PLATFORM_SIGNER ?? '';
    if (!raw) throw new SignerError(`${name} is not set.`);
  }
  let bytes: unknown;
  try {
    bytes = JSON.parse(raw);
  } catch {
    throw new SignerError(`${name} must hold a JSON array of 64 bytes (the value is not shown).`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new SignerError(`${name} must hold a JSON array of 64 bytes (the value is not shown).`);
  }
  try {
    // Keypair.fromSecretKey checks that the public half matches the private half.
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    throw new SignerError(`${name} is not a valid ed25519 keypair (the value is not shown).`);
  }
}

/**
 * pqa-qa P2-DA1: the loaded key must be the pinned platform key and no other role's. Checked at
 * startup, and again by the adapter at multisig creation and before every signature (with the
 * study's builder wallet, which only exists per study).
 */
export function assertPlatformSigner(signer: Keypair | string, roles: { platform: string; arbiter: string; feeWallet: string; builderWallet?: string }) {
  const key = typeof signer === 'string' ? signer : signer.publicKey.toBase58();
  if (key !== roles.platform) throw new SignerError('The loaded platform signer is not POCKETQA_DEVNET_PLATFORM_PUBKEY: refusing to sign.');
  if (key === roles.arbiter || key === roles.feeWallet || key === roles.builderWallet) {
    throw new SignerError('The platform signer is also another role (arbiter, fee wallet or builder): refusing to sign (no server-held second vote).');
  }
}
