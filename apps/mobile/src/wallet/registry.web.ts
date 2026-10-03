import { getWallets } from '@wallet-standard/app';
import { solanaWallets, type StandardWallet } from './standard';

/** Browser wallets registered through the Wallet Standard that can connect on devnet. */
export function availableWallets(): StandardWallet[] {
  return solanaWallets(getWallets().get() as unknown as StandardWallet[]);
}
