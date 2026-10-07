import { isDeepStrictEqual } from 'node:util';
import type { Firestore } from 'firebase-admin/firestore';
import { runTx } from '../../firestore/tx';
import type { DemoProfilesStore } from './types';

/**
 * `demoProfiles/{id}`: the labelled demo fixtures (src/devnet/demoShowcase.ts). Only meaningful
 * under the devnet namespace (the route and the seed both refuse anything else). Read and
 * upsert only: this store has no deletion path.
 */
export function firestoreDemoProfiles(fs: Firestore): DemoProfilesStore {
  const col = () => fs.collection('demoProfiles');
  return {
    // The whole collection (a dozen fixtures), no query: no composite index needed.
    async list() {
      return (await col().get()).docs.map((d) => d.data());
    },
    async seed(fixtures) {
      // One transaction: read every fixture's document, write only those that differ on a fixture field.
      return runTx(fs, async (tx) => {
        const snaps = await tx.getAll(...fixtures.map((f) => col().doc(f.id)));
        let written = 0;
        snaps.forEach((snap, i) => {
          const f = fixtures[i]!;
          const cur = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
          if (cur && Object.entries(f).every(([k, v]) => isDeepStrictEqual(cur[k], v))) return;
          tx.set(col().doc(f.id), f, { merge: true });
          written += 1;
        });
        return { written, unchanged: fixtures.length - written };
      });
    },
  };
}
