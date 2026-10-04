import type { WalletLoginResponse } from '@pocket-qa/contracts';
import { api } from '../api/client';
import { availableWallets } from './registry';
import { connectWallet, signInWithWallet, type StandardWallet } from './standard';

const b64 = (u: Uint8Array) => {
  let s = '';
  for (const byte of u) s += String.fromCharCode(byte);
  return btoa(s);
};

/**
 * Web wallet-first login (ADR 0005 §2): connect → server challenge bound to this origin →
 * `solana:signIn` (the wallet checks the domain) → server verifies the exact text, burns
 * the challenge and returns a session. Never signMessage, never a transaction.
 */
export async function walletLoginFlow(opts: { wallet?: StandardWallet; newAccount?: { role: 'tester' | 'builder'; displayName: string } } = {}): Promise<WalletLoginResponse> {
  const wallet = opts.wallet ?? availableWallets()[0];
  if (!wallet) throw new Error('No Solana wallet extension found. Install one that supports Sign In With Solana, or use email or Google.');
  const account = await connectWallet(wallet);
  const { input } = await api('walletLoginChallenge', { body: { address: account.address }, token: null });
  const signed = await signInWithWallet(wallet, input);
  return api('walletLogin', {
    body: { address: signed.address, nonce: input.nonce, signedMessage: b64(signed.signedMessage), signature: b64(signed.signature), ...(opts.newAccount ? { newAccount: opts.newAccount } : {}) },
    token: null,
  });
}
