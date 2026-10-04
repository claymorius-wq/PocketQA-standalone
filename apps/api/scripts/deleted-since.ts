// After a restore: lists the accounts that were deleted in the database the restore kept aside
// (`pocketqa.sqlite.pre-restore-<stamp>`) but are active again in the restored one. Read-only.
//   pnpm --filter @pocket-qa/api db:deleted-since -- --pre-restore <file>
// Each listed account must be deleted again before the API is reopened to users (runbook §5).
import { join, resolve } from 'node:path';
import { deletedSince } from '../src/backup';
import { loadConfig, readEnvFile, REPO_ROOT } from '../src/config';

const args = process.argv.slice(2);
const at = args.indexOf('--pre-restore');
const pre = at >= 0 ? args[at + 1] : undefined;
if (!pre) {
  console.error('usage: db:deleted-since --pre-restore <pocketqa.sqlite.pre-restore-<stamp>>');
  process.exit(2);
}
const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
let ids: string[];
try {
  ids = deletedSince(resolve(pre), join(config.dataDir, 'pocketqa.sqlite'));
} catch (e) {
  console.error(`Could not compare the databases: ${(e as Error).message}`);
  process.exit(1);
}
if (ids.length === 0) console.log('No deleted accounts came back with the restore.');
else console.log(`${ids.length} deleted account(s) came back with the restore and must be deleted again:\n${ids.join('\n')}`);
