import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from './db';

/**
 * Database backup and restore (ledger O2). The API's SQLite runs in WAL mode, so a plain
 * file copy of a live database can be torn; `backup()` is SQLite's online backup API and
 * gives a consistent snapshot while the API keeps serving. Nothing here ever deletes:
 * a restore moves the current files aside (`.pre-restore-<stamp>`) instead.
 */
export class BackupError extends Error {}

/** The running API records its pid here; a restore refuses while that process is alive. */
export const PID_FILE = 'api.pid';

/** True if `dataDir`'s API pid file names a live process (a stale file after a crash is ignored). */
export function apiRunning(dataDir: string): boolean {
  const file = join(dataDir, PID_FILE);
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const stamp = (now: number) => new Date(now).toISOString().replace(/[:.]/g, '-');
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function integrity(file: string): void {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = (db.pragma('integrity_check') as { integrity_check: string }[])[0]?.integrity_check;
    if (result !== 'ok') throw new BackupError(`Integrity check failed for ${file}: ${result}`);
    if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get()) {
      throw new BackupError(`${file} is not a Pocket QA database.`);
    }
  } finally {
    db.close();
  }
}

/** Online, consistent backup into `outDir` (0700) as a 0600 file; verified before returning. */
export async function backupDb(db: DB | Database.Database, outDir: string, now: number): Promise<{ file: string; sha256: string }> {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const file = join(outDir, `pocketqa-${stamp(now)}.sqlite`);
  if (existsSync(file)) throw new BackupError(`${file} already exists.`);
  await db.backup(file);
  // A single self-contained file: switch the copy out of WAL mode, so opening it later
  // (integrity check, restore) never leaves -wal/-shm side files next to it.
  const copy = new Database(file);
  copy.pragma('journal_mode = DELETE');
  copy.close();
  chmodSync(file, 0o600);
  integrity(file);
  return { file, sha256: sha256(file) };
}

/**
 * Restore `backupFile` as the database at `dbFile`. The API must be stopped (the caller
 * checks); the backup is integrity-checked first, and the current database plus its WAL
 * and SHM files are kept beside it, renamed, never deleted.
 */
export function restoreDb(backupFile: string, dbFile: string, now: number): { keptAs: string[] } {
  if (!existsSync(backupFile)) throw new BackupError(`No backup at ${backupFile}.`);
  integrity(backupFile);
  const keptAs: string[] = [];
  for (const suffix of ['', '-wal', '-shm']) {
    if (!existsSync(dbFile + suffix)) continue;
    const aside = `${dbFile}${suffix}.pre-restore-${stamp(now)}`;
    renameSync(dbFile + suffix, aside);
    keptAs.push(aside);
  }
  copyFileSync(backupFile, dbFile);
  chmodSync(dbFile, 0o600);
  integrity(dbFile);
  return { keptAs };
}
