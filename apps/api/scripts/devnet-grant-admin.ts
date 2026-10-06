// Promotes ONE synthetic, verified, dedicated account to admin in the DEVNET namespace only
// (docs/reviews/devnet/devnet-live-run.md §4). Run on the host with the devnet deployment's env:
//   npx tsx scripts/devnet-grant-admin.ts devnet-admin@example.test --reason "Devnet dispute overturn operator"
// It loads config as the devnet deployment does (refusing anything but POCKETQA_ENV=devnet) and
// writes only under pocketqaNamespaces/devnet. No HTTP route exists for this. Prints the user id.
import { userInfo } from 'node:os';
import { GrantError } from '../src/adminGrant';
import { loadConfig } from '../src/config';
import { grantDevnetAdmin } from '../src/devnet/grantDevnetAdmin';
import { openFirestore } from '../src/firestore/admin';
import { makeRepos } from '../src/repo';

const args = process.argv.slice(2);
const reasonAt = args.indexOf('--reason');
if (!args[0] || reasonAt < 0) {
  console.error('usage: devnet-grant-admin.ts <email> --reason "<why>"');
  process.exit(2);
}
try {
  const config = loadConfig(process.env);
  if (!config.devnet) throw new GrantError('Run with the devnet deployment env (POCKETQA_ENV=devnet).');
  const repos = makeRepos({ kind: 'firestore', fs: openFirestore(process.env, config.firebase!.projectId), namespace: 'devnet' });
  const { userId } = await grantDevnetAdmin(repos, { email: args[0], reason: args[reasonAt + 1] ?? '', operator: userInfo().username, nowMs: Date.now(), allowedEmails: config.devnet.allowedEmails });
  console.log(JSON.stringify({ userId, namespace: 'devnet' }));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
