import { useEffect, useState } from 'react';
import { availableWallets, watchWallets } from './registry';
import type { StandardWallet } from './standard';

/** The installed Wallet Standard wallets (web), kept current as extensions register. */
export function useWallets(): StandardWallet[] {
  const [wallets, setWallets] = useState(availableWallets);
  useEffect(() => {
    setWallets(availableWallets());
    return watchWallets(() => setWallets(availableWallets()));
  }, []);
  return wallets;
}
