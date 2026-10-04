// Promotes an existing, verified managed-identity account to admin (production: firebase).
//   pnpm --filter @pocket-qa/api admin:grant ops@example.com --reason "Platform operations lead"
// Run on the API host against the deployment's data dir. No HTTP route exists for this.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { Email } from '@pocket-qa/contracts';
import { GrantError, grantAdmin } from '../src/adminGrant';
import { loadConfig, readEnvFile, REPO_ROOT } from '../src/config';
import Database from 'better-sqlite3';
import { MIGRATION_COUNT } from '../src/db';

const args = process.argv.slice(2);
const email = Email.safeParse(args[0]);
const reasonAt = args.indexOf('--reason');
const reason = reasonAt > 0 ? (args[reasonAt + 1] ?? '') : '';
if (!email.success || reasonAt < 0) {
  console.error('usage: admin:grant <email> --reason "<why this person administers Pocket QA>"');
  process.exit(2);
}
const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
if (config.authMode !== 'firebase') {
  console.error('admin:grant is for managed sign-in deployments. With local auth use admin:create.');
  process.exit(1);
}
const file = join(config.dataDir, 'pocketqa.sqlite');
if (!existsSync(file)) {
  console.error('No database in POCKETQA_DATA_DIR. Start the API once and have the person sign up first.');
  process.exit(1);
}
// Never migrate the live database from an operator tool (inc4 review P3-2 class): the
// schema must already match this code, e.g. not mid-upgrade with the old API running.
const db = new Database(file, { fileMustExist: true });
db.pragma('foreign_keys = ON');
const applied = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
if (applied !== MIGRATION_COUNT) {
  console.error(`The database schema (${applied} migrations) doesn't match this code (${MIGRATION_COUNT}). Run admin:grant from the same version as the running API.`);
  process.exit(1);
}
try {
  const { userId } = grantAdmin(db, { email: email.data, reason, operator: userInfo().username, now: Date.now() });
  console.log(`Granted admin to account ${userId}. Recorded in the audit log.`);
} catch (e) {
  if (!(e instanceof GrantError)) throw e;
  console.error(e.message);
  process.exit(1);
}
