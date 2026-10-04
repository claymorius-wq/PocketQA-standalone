import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Ledger D2: with managed sign-in (always the case in production) no local password admin,
// including the demo seed's `demo-admin@…`, can be created; nothing is written.
describe('admin:create', () => {
  it('refuses when auth is not local, before touching the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-admin-'));
    const r = spawnSync('npx', ['tsx', 'scripts/create-admin.ts', 'demo-admin@pocketqa.example'], {
      cwd: join(import.meta.dirname, '..'),
      input: 'a-long-enough-password\n',
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, POCKETQA_DATA_DIR: dir, POCKETQA_ENV: 'development', POCKETQA_AUTH_MODE: 'firebase', POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-staging', POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key' }, // check-secrets: allow (placeholder public Firebase web config in tests)
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/admin:grant/);
    expect(existsSync(join(dir, 'pocketqa.sqlite'))).toBe(false);
  }, 60_000);
});
