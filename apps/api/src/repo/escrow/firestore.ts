import type { Firestore } from 'firebase-admin/firestore';
import type { EscrowRepo, WalletLink } from './types';

/** Collections of this domain (plan §2.1, r2 §R2). */
export const C = {
  walletLinks: 'walletLinks',
} as const;

export function firestoreEscrowRepo(fs: Firestore): EscrowRepo {
  const done: Pick<EscrowRepo, 'walletLinkOf'> = {
    async walletLinkOf(userId) {
      const snap = await fs.collection(C.walletLinks).doc(userId).get();
      if (!snap.exists) return null;
      const d = snap.data() as { address: string; linkedAt: string };
      return { address: d.address, linkedAt: d.linkedAt } satisfies WalletLink;
    },
  };
  // Step B (pqa-be3) implements the rest natively; until then every other operation fails loudly,
  // never silently.
  return new Proxy(done as EscrowRepo, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof EscrowRepo];
      return async () => {
        throw new Error(`firestore escrow repo: ${prop} is not implemented yet`);
      };
    },
  });
}
