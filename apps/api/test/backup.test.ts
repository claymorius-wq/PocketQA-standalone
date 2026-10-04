import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackupError, backupDb, restoreDb } from '../src/backup';
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
    const before = openDb(keptAs.find((f) => !f.includes('.sqlite-wal') && !f.includes('.sqlite-shm'))!);
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
