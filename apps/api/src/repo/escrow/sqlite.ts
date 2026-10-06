import type { DB } from '../../db';
import type { EscrowRepo, WalletLink } from './types';

export function sqliteEscrowRepo(db: DB): EscrowRepo {
  return {
    async walletLinkOf(userId) {
      const r = db.prepare('SELECT address, linked_at FROM wallet_links WHERE user_id = ?').get(userId) as { address: string; linked_at: string } | undefined;
      return r ? ({ address: r.address, linkedAt: r.linked_at } satisfies WalletLink) : null;
    },
  };
}
