import type { StandardWallet } from './standard';

/** Native (Android uses MWA; iOS has none): no Wallet Standard browser wallets. */
export function availableWallets(): StandardWallet[] {
  return [];
}
