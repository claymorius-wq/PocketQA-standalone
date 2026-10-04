// Restores a verified backup over the API database (ledger O2). Stop the API first: this
// refuses while anything answers on the API port. The current database is kept beside the
// restored one (`.pre-restore-<stamp>`), never deleted.
//   pnpm --filter @pocket-qa/api db:restore -- --from /var/backups/pocketqa/pocketqa-<stamp>.sqlite
import { join, resolve } from 'node:path';
import { apiRunning, BackupError, restoreDb } from '../src/backup';
import { loadConfig, readEnvFile, REPO_ROOT } from '../src/config';

const args = process.argv.slice(2);
const at = args.indexOf('--from');
const from = at >= 0 ? args[at + 1] : undefined;
if (!from) {
  console.error('usage: db:restore --from <backup file>');
  process.exit(2);
}
const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
const running = await fetch(`http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}/health`, { signal: AbortSignal.timeout(1500) })
  .then(() => true)
  .catch(() => false);
if (running || apiRunning(config.dataDir)) {
  console.error(`The API is running (port ${config.port} answers, or its pid file names a live process). Stop it before restoring (launchctl bootout …/ai.pocketqa.api).`);
  process.exit(1);
}
try {
  const r = restoreDb(resolve(from), join(config.dataDir, 'pocketqa.sqlite'), Date.now());
  console.log(`restored; previous files kept as: ${r.keptAs.join(', ') || '(none)'}`);
} catch (e) {
  if (!(e instanceof BackupError)) throw e;
  console.error(e.message);
  process.exit(1);
}
