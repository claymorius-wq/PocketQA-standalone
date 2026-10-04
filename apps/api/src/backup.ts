import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
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
export function restoreDb(backupFile: string, dbFile: string, now: number): { keptAs: string[]; warnings: string[] } {
  if (!existsSync(backupFile)) throw new BackupError(`No backup at ${backupFile}.`);
  integrity(backupFile);
  // The current database moves aside with its WAL and SHM under SQLite's own sidecar names
  // (`<aside>-wal`, `<aside>-shm`), so opening the kept copy replays writes that were never
  // checkpointed, e.g. after a crash (inc5 review P2-1). It is then checkpointed into one
  // self-contained file; SQLite drops the emptied sidecars itself, and no data is lost.
  const aside = `${dbFile}.pre-restore-${stamp(now)}`;
  if (existsSync(aside)) throw new BackupError(`${aside} already exists.`);
  const keptAs: string[] = [];
  const warnings: string[] = [];
  if (existsSync(dbFile)) {
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbFile + suffix)) renameSync(dbFile + suffix, aside + suffix);
    keptAs.push(aside);
    // A corrupt or unreadable live database still gets replaced (that is often why one restores):
    // it is kept with its sidecars and the restore goes on (inc5 review P2-2). Opening it may let
    // SQLite rewrite a damaged main file or drop an invalid WAL (inc5 review r3 P3-3).
    try {
      const kept = new Database(aside, { fileMustExist: true });
      try {
        kept.pragma('wal_checkpoint(TRUNCATE)');
        kept.pragma('journal_mode = DELETE');
      } finally {
        kept.close();
      }
    } catch (e) {
      for (const suffix of ['-wal', '-shm']) if (existsSync(aside + suffix)) keptAs.push(aside + suffix);
      warnings.push(`The previous database could not be opened (${(e as Error).message}); it is kept as ${aside} (SQLite may have rewritten or dropped damaged parts when opening it) and was not checked for deletions to re-apply.`);
    }
  }
  copyFileSync(backupFile, dbFile);
  chmodSync(dbFile, 0o600);
  integrity(dbFile);
  return { keptAs, warnings };
}

/**
 * Startup guard: a data dir with kept `.pre-restore-*` copies but no live database means a restore
 * did not finish. Starting would create a fresh, empty database and hide that (inc5 review P2-2).
 */
export function unfinishedRestore(dataDir: string, dbName = 'pocketqa.sqlite'): string | null {
  if (existsSync(join(dataDir, dbName)) || !existsSync(dataDir)) return null;
  const kept = readdirSync(dataDir).filter((f) => f.startsWith(`${dbName}.pre-restore-`) && !/-(wal|shm)$/.test(f));
  return kept.length ? `No ${dbName} in the data dir, but ${kept.length} pre-restore copy(ies) exist (${kept.sort().at(-1)}). Finish the restore (db:restore) before starting the API.` : null;
}

/**
 * Accounts deleted in `preRestoreFile` (the database a restore moved aside) that the restored
 * `currentFile` brought back. Each must be deleted again before users return (runbook §5).
 * Both files are opened read-only; nothing is changed here.
 */
export function deletedSince(preRestoreFile: string, currentFile: string): string[] {
  const pre = new Database(preRestoreFile, { readonly: true, fileMustExist: true });
  const cur = new Database(currentFile, { readonly: true, fileMustExist: true });
  try {
    const gone = pre.prepare(`SELECT id FROM users WHERE status = 'deleted' ORDER BY id`).all() as { id: string }[];
    const back = cur.prepare(`SELECT status FROM users WHERE id = ?`);
    return gone.map((r) => r.id).filter((id) => {
      const row = back.get(id) as { status: string } | undefined;
      return row !== undefined && row.status !== 'deleted';
    });
  } finally {
    pre.close();
    cur.close();
  }
}
