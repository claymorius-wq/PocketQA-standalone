import type { Firestore } from 'firebase-admin/firestore';
import { sameDemoDoc } from '../../devnet/demoShowcase';
import { runTx } from '../../firestore/tx';
import type { DemoProfilesStore } from './types';

/**
 * `demoProfiles/{id}`: the labelled demo fixtures (src/devnet/demoShowcase.ts). Only meaningful
 * under the devnet namespace (the route and the seed both refuse anything else). Read and create
 * only: this store never overwrites a differing document and has no deletion path.
 */
export function firestoreDemoProfiles(fs: Firestore): DemoProfilesStore {
  const col = () => fs.collection('demoProfiles');
  return {
    // The whole collection (a dozen fixtures), no query: no composite index needed.
    async list() {
      return (await col().get()).docs.map((d) => d.data());
    },
    async seed(fixtures) {
      // One transaction: read every fixture's document; if any differs, write nothing; else create the missing ones.
      return runTx(fs, async (tx) => {
        const snaps = await tx.getAll(...fixtures.map((f) => col().doc(f.id)));
        const differing = fixtures.filter((f, i) => snaps[i]!.exists && !sameDemoDoc(snaps[i]!.data(), f)).map((f) => f.id);
        if (differing.length) return { written: 0, unchanged: 0, differing };
        const missing = fixtures.filter((_, i) => !snaps[i]!.exists);
        for (const f of missing) tx.set(col().doc(f.id), f, { merge: true });
        return { written: missing.length, unchanged: fixtures.length - missing.length, differing: [] };
      });
    },
  };
}
