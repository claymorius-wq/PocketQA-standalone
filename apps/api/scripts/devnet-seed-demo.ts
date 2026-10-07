// Seeds the labelled DEMO showcase fixtures (8 testers, 2 builders: at most 10; src/devnet/demoShowcase.ts) into
// the DEVNET namespace only. Run on the host with the devnet deployment's env:
//   npx tsx scripts/devnet-seed-demo.ts
// It loads config as the devnet deployment does (refusing anything but POCKETQA_ENV=devnet) and
// writes only pocketqaNamespaces/devnet/demoProfiles/demo-1 … demo-10, and only with
// POCKETQA_DEMO_SHOWCASE=1. Idempotent: fixed ids; only missing documents are written, an equal one
// is left alone (a second run writes 0), and a differing one makes it refuse without writing. It
// creates no account, sign-in, participation, ledger, rating or payout, and has no deletion path.
import { loadConfig } from '../src/config';
import { DemoSeedError, seedDemoShowcase } from '../src/devnet/demoShowcase';
import { openFirestore } from '../src/firestore/admin';
import { makeRepos } from '../src/repo';

try {
  const config = loadConfig(process.env);
  if (!config.devnet) throw new DemoSeedError('Run with the devnet deployment env (POCKETQA_ENV=devnet).');
  if (!config.devnet.demoShowcase) throw new DemoSeedError('The demo showcase is off: set POCKETQA_DEMO_SHOWCASE=1 in the devnet env first.');
  const repos = makeRepos({ kind: 'firestore', fs: openFirestore(process.env, config.firebase!.projectId), namespace: 'devnet' });
  const result = await seedDemoShowcase(repos);
  console.log(JSON.stringify({ namespace: 'devnet', collection: 'demoProfiles', ...result }));
  if (result.readBack !== result.total) {
    console.error(`read back ${result.readBack} of ${result.total} demo profiles`);
    process.exit(1);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
