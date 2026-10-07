// Seeds the labelled DEMO showcase fixtures (8 testers, 4 builders; src/devnet/demoShowcase.ts) into
// the DEVNET namespace only. Run on the host with the devnet deployment's env:
//   npx tsx scripts/devnet-seed-demo.ts
// It loads config as the devnet deployment does (refusing anything but POCKETQA_ENV=devnet) and
// writes only pocketqaNamespaces/devnet/demoProfiles/demo-1 … demo-12. Idempotent: fixed ids, set
// with merge, a document already equal is left alone, so a second run writes 0. It creates no
// account, sign-in, participation, ledger, rating or payout, and has no deletion path. Prints counts.
import { loadConfig } from '../src/config';
import { DemoSeedError, seedDemoShowcase } from '../src/devnet/demoShowcase';
import { openFirestore } from '../src/firestore/admin';
import { makeRepos } from '../src/repo';

try {
  const config = loadConfig(process.env);
  if (!config.devnet) throw new DemoSeedError('Run with the devnet deployment env (POCKETQA_ENV=devnet).');
  const repos = makeRepos({ kind: 'firestore', fs: openFirestore(process.env, config.firebase!.projectId), namespace: 'devnet' });
  const result = await seedDemoShowcase(repos);
  console.log(JSON.stringify({ namespace: 'devnet', collection: 'demoProfiles', ...result, showcaseEnabled: config.devnet.demoShowcase }));
  if (result.readBack !== result.total) {
    console.error(`read back ${result.readBack} of ${result.total} demo profiles`);
    process.exit(1);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
