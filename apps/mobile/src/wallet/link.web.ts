import { buildSiwsMessage } from '@pocket-qa/contracts';
import { api } from '../api/client';
import { availableWallets } from './registry';
import { connectWallet, signMessageWithWallet, type StandardWallet } from './standard';

const b64 = (u: Uint8Array) => {
  let s = '';
  for (const byte of u) s += String.fromCharCode(byte);
  return btoa(s);
};

/**
 * Web: link a devnet wallet to the signed-in account through the Wallet Standard
 * (`solana:signMessage` over the server's exact link text). The export keeps the shared
 * name used by the Settings wallet section on every platform.
 */
export async function linkWalletWithMwa(opts: { wallet?: StandardWallet } = {}): Promise<void> {
  const wallet = opts.wallet ?? availableWallets()[0];
  if (!wallet) throw new Error('No Solana wallet extension found.');
  const account = await connectWallet(wallet);
  // Bound to this deployment's real origin, so the wallet's SIWS domain check matches the page.
  const { input } = await api('walletNonce', { body: { address: account.address, surface: 'web' } });
  const message = new TextEncoder().encode(buildSiwsMessage(input));
  const out = await signMessageWithWallet(wallet, account, message);
  await api('walletLink', { body: { address: account.address, nonce: input.nonce, signedMessage: b64(out.signedMessage), signature: b64(out.signature) } });
}
