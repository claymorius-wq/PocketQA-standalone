import { buildSiwsMessage, type SiwsInput } from '@pocket-qa/contracts';
import { api } from '../api/client';
import { availableWallets } from './registry';
import { connectWallet, disconnectWallet, signMessageWithWallet, type StandardAccount, type StandardWallet } from './standard';

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
  let account: StandardAccount;
  let input: SiwsInput;
  let out: { signedMessage: Uint8Array; signature: Uint8Array };
  try {
    account = await connectWallet(wallet);
    // Bound to this deployment's real origin, so the wallet's SIWS domain check matches the page.
    ({ input } = await api('walletNonce', { body: { address: account.address, surface: 'web' } }));
    out = await signMessageWithWallet(wallet, account, new TextEncoder().encode(buildSiwsMessage(input)));
  } finally {
    await disconnectWallet(wallet);
  }
  await api('walletLink', { body: { address: account.address, nonce: input.nonce, signedMessage: b64(out.signedMessage), signature: b64(out.signature) } });
}
