import type { Firestore } from 'firebase-admin/firestore';

/**
 * The devnet namespace (devnet-phase-contract.md CH-D2): THE one function that isolates devnet
 * data inside the production project. Every collection and document path is re-rooted under
 * `pocketqaNamespaces/devnet/`, so the repositories run unchanged and can't name a production
 * collection. Collection-group queries would cross namespaces, so they throw. Transactions, batched
 * writes and getAll operate on references already rooted here, so they pass through.
 *
 * Composite indexes and TTL overrides are keyed by collection id (COLLECTION scope), so they apply
 * to the namespaced subcollections unchanged; the deny-all rules cover every path.
 */
export const DEVNET_ROOT = 'pocketqaNamespaces/devnet';

export function devnetFirestore(fs: Firestore): Firestore {
  const root = fs.doc(DEVNET_ROOT);
  return new Proxy(fs, {
    get(target, prop, receiver) {
      if (prop === 'collection') return (path: string) => root.collection(path);
      if (prop === 'doc') return (path: string) => fs.doc(`${DEVNET_ROOT}/${path}`);
      if (prop === 'collectionGroup' || prop === 'listCollections' || prop === 'recursiveDelete') {
        return () => {
          throw new Error(`devnetFirestore: ${String(prop)} would reach outside the devnet namespace.`);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
