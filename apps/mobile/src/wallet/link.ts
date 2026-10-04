import type { StandardWallet } from './standard';

// iOS: Mobile Wallet Adapter is Android-only and there is no Wallet Standard. The UI never
// offers linking here (walletCapability), and this throws rather than pretending to link.
export async function linkWalletWithMwa(_opts: { wallet?: StandardWallet } = {}): Promise<never> {
  throw new Error('Wallet linking uses Mobile Wallet Adapter, which works only in the Android app.');
}
