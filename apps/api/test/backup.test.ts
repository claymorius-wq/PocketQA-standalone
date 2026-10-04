import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackupError, backupDb, deletedSince, restoreDb, unfinishedRestore } from '../src/backup';
import { openDb } from '../src/db';
import { iso, newId } from '../src/util';

// Ledger O2: backup while the database is open (WAL), verify, then a restore drill.
const user = (email: string) => ({ id: newId(), email, display_name: 'U', role: 'tester', status: 'active', created_at: iso(Date.now()) });
const add = (db: ReturnType<typeof openDb>, email: string) =>
  db.prepare('INSERT INTO users (id, email, display_name, role, status, created_at) VALUES (@id,@email,@display_name,@role,@status,@created_at)').run(user(email));
const emails = (db: ReturnType<typeof openDb>) => (db.prepare('SELECT email FROM users ORDER BY email').all() as { email: string }[]).map((r) => r.email);

describe('database backup and restore drill', () => {
  it('online backup of a live WAL database, mutate, restore: the backup state returns and nothing is deleted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-backup-'));
    const dbFile = join(dir, 'data', 'pocketqa.sqlite');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'data'));
    const live = openDb(dbFile);
    add(live, 'a@example.test');
    add(live, 'b@example.test');
    // Uncheckpointed writes sit in the WAL; the online backup must still include them.
    expect(existsSync(`${dbFile}-wal`)).toBe(true);
    const { file, sha256 } = await backupDb(live, join(dir, 'backups'), Date.UTC(2026, 9, 4, 12));
    expect(file).toMatch(/pocketqa-2026-10-04T12-00-00-000Z\.sqlite$/);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'backups')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(dir, 'backups'))).toEqual([file.split('/').pop()]); // no -wal/-shm beside it

    add(live, 'c@example.test'); // after the backup
    expect(emails(live)).toEqual(['a@example.test', 'b@example.test', 'c@example.test']);
    live.close(); // the API is stopped for a restore

    const { keptAs } = restoreDb(file, dbFile, Date.UTC(2026, 9, 4, 13));
    expect(keptAs.length).toBeGreaterThanOrEqual(1);
    for (const f of keptAs) expect(existsSync(f)).toBe(true); // moved aside, never deleted
    const restored = openDb(dbFile);
    expect(emails(restored)).toEqual(['a@example.test', 'b@example.test']);
    restored.close();
    // The pre-restore copy still holds the newer state.
    const before = openDb(keptAs[0]!);
    expect(emails(before)).toContain('c@example.test');
    before.close();
    expect(readdirSync(join(dir, 'data')).some((f) => f.includes('.pre-restore-'))).toBe(true);
  });

  it('refuses a corrupt or foreign file, and never overwrites an existing backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-backup-'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'junk.sqlite'), 'not a database at all');
    expect(() => restoreDb(join(dir, 'junk.sqlite'), join(dir, 'pocketqa.sqlite'), Date.now())).toThrow();
    const Database = (await import('better-sqlite3')).default;
    const foreign = new Database(join(dir, 'foreign.sqlite'));
    foreign.exec('CREATE TABLE t (x)');
    foreign.close();
    expect(() => restoreDb(join(dir, 'foreign.sqlite'), join(dir, 'pocketqa.sqlite'), Date.now())).toThrow(BackupError);
    expect(existsSync(join(dir, 'pocketqa.sqlite'))).toBe(false);
    const db = openDb(join(dir, 'live.sqlite'));
    await backupDb(db, join(dir, 'b'), 1);
    await expect(backupDb(db, join(dir, 'b'), 1)).rejects.toThrow(/already exists/);
    db.close();
  });
});

describe('backup never migrates the live database (inc4 review P3-2)', () => {
  it('backs up from a read-only connection; schema_migrations is unchanged', async () => {
    const Database = (await import('better-sqlite3')).default;
    const dir = mkdtempSync(join(tmpdir(), 'pqa-backup-ro-'));
    const file = join(dir, 'pocketqa.sqlite');
    openDb(file).close();
    const raw = new Database(file);
    raw.prepare('DELETE FROM schema_migrations WHERE version = (SELECT MAX(version) FROM schema_migrations)').run(); // simulate an older schema
    const before = (raw.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    raw.close();
    const ro = new Database(file, { readonly: true, fileMustExist: true });
    await backupDb(ro, join(dir, 'b'), 1);
    ro.close();
    const after = new Database(file, { readonly: true });
    expect((after.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(before);
    after.close();
  });
});

describe('after a restore: deletions to re-apply (inc4 review P3-1)', () => {
  it('lists accounts deleted since the backup that the restore brought back, and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-deleted-since-'));
    const dbFile = join(dir, 'pocketqa.sqlite');
    const live = openDb(dbFile);
    add(live, 'keep@example.test');
    add(live, 'gone@example.test');
    add(live, 'gone-before@example.test');
    const id = (email: string) => (live.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
    const [gone, goneBefore] = [id('gone@example.test'), id('gone-before@example.test')];
    live.prepare(`UPDATE users SET status = 'deleted' WHERE id = ?`).run(goneBefore); // deleted before the backup
    const { file } = await backupDb(live, join(dir, 'b'), 1);
    live.prepare(`UPDATE users SET status = 'deleted' WHERE id = ?`).run(gone); // deleted after it
    live.close();
    const { keptAs } = restoreDb(file, dbFile, 2);
    const pre = keptAs[0]!;
    expect(deletedSince(pre, dbFile)).toEqual([gone]);
  });
});

describe('restore after a crash keeps un-checkpointed writes (inc5 review P2-1)', () => {
  it('a deletion still in the WAL when the API died is in the kept copy, so deletedSince finds it', async () => {
    const { spawnSync } = await import('node:child_process');
    const { existsSync: exists, mkdirSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'pqa-crash-'));
    mkdirSync(join(dir, 'data'));
    const dbFile = join(dir, 'data', 'pocketqa.sqlite');
    const db = openDb(dbFile);
    add(db, 'gone@example.test');
    const gone = (db.prepare('SELECT id FROM users').get() as { id: string }).id;
    const { file } = await backupDb(db, join(dir, 'b'), 1);
    db.close();
    // A separate process deletes the account and dies without closing: the change stays in the WAL.
    const child = spawnSync(process.execPath, ['-e', `
      const Database = require('better-sqlite3');
      const db = new Database(${JSON.stringify(dbFile)});
      db.pragma('journal_mode = WAL');
      db.pragma('wal_autocheckpoint = 0');
      db.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").run(${JSON.stringify(gone)});
      process.exit(0);
    `], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
    expect(child.status, child.stderr).toBe(0);
    expect(exists(`${dbFile}-wal`)).toBe(true);

    const { keptAs } = restoreDb(file, dbFile, 2);
    expect(keptAs).toHaveLength(1);
    expect(deletedSince(keptAs[0]!, dbFile)).toEqual([gone]);
    // The kept copy is one self-contained file now (checkpointed, out of WAL mode).
    expect(exists(`${keptAs[0]}-wal`)).toBe(false);
  });
});

describe('restore over a corrupt live database (inc5 review P2-2)', () => {
  it('replaces it, keeps the corrupt file as it was, and warns instead of failing half-way', async () => {
    const { writeFileSync, readFileSync: read, mkdirSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'pqa-corrupt-'));
    mkdirSync(join(dir, 'data'));
    const dbFile = join(dir, 'data', 'pocketqa.sqlite');
    const src = openDb(join(dir, 'src.sqlite'));
    add(src, 'keep@example.test');
    const { file } = await backupDb(src, join(dir, 'b'), 1);
    src.close();
    const junk = Buffer.alloc(8192, 7);
    writeFileSync(dbFile, junk);
    const { keptAs, warnings } = restoreDb(file, dbFile, 2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not be opened.*kept as/);
    expect(read(keptAs[0]!)).toEqual(junk);
    const restored = openDb(dbFile);
    expect(emails(restored)).toEqual(['keep@example.test']);
    restored.close();
  });

  it('the API refuses to start on a data dir left with only pre-restore copies', async () => {
    const { writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'pqa-unfinished-'));
    expect(unfinishedRestore(dir)).toBeNull();
    writeFileSync(join(dir, 'pocketqa.sqlite.pre-restore-2026-10-04T00-00-00-000Z'), 'x');
    expect(unfinishedRestore(dir)).toMatch(/Finish the restore/);
    writeFileSync(join(dir, 'pocketqa.sqlite'), '');
    expect(unfinishedRestore(dir)).toBeNull();
  });
});
