// READ-ONLY: the devnet spend books against the chain, per operation (reserved vs the observed
// fee + rent of its recorded transactions) and in total. Writes nothing; prints numbers and op keys
// only. Run with the devnet deployment's env (Firestore credentials). It reads costs with the platform
// PUBLIC key only (POCKETQA_DEVNET_PLATFORM_PUBKEY): the platform secret is never loaded (P3-SR1).
//   npx tsx scripts/devnet-spend-report.ts
import { loadConfig } from '../src/config';
import { spendReport } from '../src/devnet/spendReport';
import { openFirestore } from '../src/firestore/admin';
import { devnetFirestore } from '../src/firestore/namespace';
import { rpcCostReader } from '../src/settlement/squads/rpcDevnetChain';

try {
  const config = loadConfig(process.env);
  if (!config.devnet) throw new Error('Run with the devnet deployment env (POCKETQA_ENV=devnet).');
  const chain = rpcCostReader(config.rpcUrl, config.devnet.platform);
  const report = await spendReport(devnetFirestore(openFirestore(process.env, config.firebase!.projectId)), chain);
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
