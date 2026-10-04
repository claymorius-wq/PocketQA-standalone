import type { WalletLoginResponse } from '@pocket-qa/contracts';

// Android/iOS: wallet-first login is not offered (ADR 0005 §2). Android keeps MWA account
// linking only, until an MWA sign_in_payload flow with verified app identity exists.
export async function walletLoginFlow(_opts: { newAccount?: { role: 'tester' | 'builder'; displayName: string } } = {}): Promise<WalletLoginResponse> {
  throw new Error('Wallet sign-in is available in the web app with a Solana wallet extension.');
}
