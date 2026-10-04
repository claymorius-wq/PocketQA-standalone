// Online backup of the API database (ledger O2), safe while the API is running.
//   pnpm --filter @pocket-qa/api db:backup -- --out /var/backups/pocketqa
// The output directory must be outside the repository. Prints the file and its sha256.
import { join, relative, isAbsolute, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { BackupError, backupDb } from '../src/backup';
import { loadConfig, readEnvFile, REPO_ROOT } from '../src/config';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = at >= 0 ? args[at + 1] : process.env.POCKETQA_BACKUP_DIR;
if (!out) {
  console.error('usage: db:backup --out <directory outside the repository>   (or POCKETQA_BACKUP_DIR)');
  process.exit(2);
}
const dir = resolve(out);
// Resolve symlinks through the nearest existing ancestor, so a link into the repo is caught.
let probe = dir;
while (!existsSync(probe)) probe = dirname(probe);
const real = join(realpathSync(probe), relative(probe, dir));
const rel = relative(realpathSync(REPO_ROOT), real);
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
  console.error('Backups must be written outside the repository.');
  process.exit(1);
}
const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
const file = join(config.dataDir, 'pocketqa.sqlite');
if (!existsSync(file)) {
  console.error('No database in POCKETQA_DATA_DIR.');
  process.exit(1);
}
try {
  // Read-only: a backup never runs migrations against the live database (inc4 review P3-2).
  const r = await backupDb(new Database(file, { readonly: true, fileMustExist: true }), dir, Date.now());
  console.log(`backup ${r.file} sha256=${r.sha256}`);
} catch (e) {
  if (!(e instanceof BackupError)) throw e;
  console.error(e.message);
  process.exit(1);
}
