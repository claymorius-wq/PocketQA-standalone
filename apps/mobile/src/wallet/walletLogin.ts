import type { WalletLoginResponse } from '@pocket-qa/contracts';
import type { StandardWallet } from './standard';

// iOS (and any platform without a wallet path): wallet-first login is not offered. Web uses
// the Wallet Standard (walletLogin.web.ts); Android uses Mobile Wallet Adapter
// (walletLogin.android.ts). Mobile Wallet Adapter does not apply to iOS (CLAUDE.md).
export async function walletLoginFlow(_opts: { wallet?: StandardWallet; newAccount?: { role: 'tester' | 'builder'; displayName: string } } = {}): Promise<WalletLoginResponse> {
  throw new Error('Wallet sign-in is available in the Android app and in the web app with a Solana wallet extension.');
}
