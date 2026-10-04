import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config';
import { openDb } from '../src/db';

// Ledger O2: the operator CLIs for backup and the restore drill.
const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync('npx', ['tsx', `scripts/${script}`, ...args], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, POCKETQA_API_PORT: String(20000 + Math.floor(Math.random() * 20000)), ...env },
  });

describe('db:backup and db:restore', () => {
  it('backs up outside the repo only, then restores while the API is stopped, keeping the old files', () => {
    const data = mkdtempSync(join(tmpdir(), 'pqa-dbs-'));
    const db = openDb(join(data, 'pocketqa.sqlite'));
    db.prepare(`INSERT INTO users (id, email, display_name, role, status, created_at) VALUES ('u1','x@example.test','X','tester','active','2026-10-04T00:00:00.000Z')`).run();
    db.close();
    const env = { POCKETQA_DATA_DIR: data };

    const inRepo = run('backup-db.ts', ['--out', join(REPO_ROOT, 'apps/api/.data/backups')], env);
    expect([inRepo.status, inRepo.stderr]).toEqual([1, expect.stringMatching(/outside the repository/)]);

    // A symlink outside the repo that points into it is caught (inc4 review P3-5).
    const linkDir = mkdtempSync(join(tmpdir(), 'pqa-dbs-link-'));
    symlinkSync(join(REPO_ROOT, 'apps/api'), join(linkDir, 'into-repo'));
    const viaLink = run('backup-db.ts', ['--out', join(linkDir, 'into-repo', 'backups-test')], env);
    expect([viaLink.status, viaLink.stderr]).toEqual([1, expect.stringMatching(/outside the repository/)]);
    expect(existsSync(join(REPO_ROOT, 'apps/api/backups-test'))).toBe(false);
    const out = mkdtempSync(join(tmpdir(), 'pqa-dbs-out-'));
    const b = run('backup-db.ts', ['--out', out], env);
    expect(b.status).toBe(0);
    expect(b.stdout).toMatch(/backup .*pocketqa-.*\.sqlite sha256=[0-9a-f]{64}/);
    const file = join(out, readdirSync(out)[0]!);

    const r = run('restore-db.ts', ['--from', file], env);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/previous files kept as: .*pre-restore-/);
    expect(readdirSync(data).some((f) => f.startsWith('pocketqa.sqlite.pre-restore-'))).toBe(true);
    expect(existsSync(join(data, 'pocketqa.sqlite'))).toBe(true);

    expect(run('restore-db.ts', [], env).status).toBe(2);
  }, 120_000);
});
