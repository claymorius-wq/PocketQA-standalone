import { getWallets } from '@wallet-standard/app';
import { solanaWallets, type StandardWallet } from './standard';

/** Browser wallets registered through the Wallet Standard that can connect on devnet. */
export function availableWallets(): StandardWallet[] {
  return solanaWallets(getWallets().get() as unknown as StandardWallet[]);
}

/** Calls `onChange` when a wallet extension registers or unregisters (they load late). */
export function watchWallets(onChange: () => void): () => void {
  const w = getWallets();
  const offRegister = w.on('register', onChange);
  const offUnregister = w.on('unregister', onChange);
  return () => {
    offRegister();
    offUnregister();
  };
}
