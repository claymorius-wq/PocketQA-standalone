// Production build script refusals (ledger D1, O5). These fail before any build starts.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiProblem, isPublicHost, outProblem } from './production/check-url.mjs';

const SCRIPT = join(import.meta.dirname, 'production/build-web.sh');
const run = (env) => spawnSync('bash', [SCRIPT], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8' });

test('production web build refuses the demo preview switch', () => {
  const r = run({ PROD_API_URL: '/api', EXPO_PUBLIC_PREVIEW: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /demo preview/);
});

test('production web build refuses missing, plain-http and loopback API URLs', () => {
  for (const PROD_API_URL of ['', 'http://api.pocketqa.example', 'https://127.0.0.1:8787', 'https://localhost/api', 'https://10.0.2.2', 'https://127.1', 'https://0.0.0.0', 'https://localhost.', 'https://[::ffff:127.0.0.1]', 'https://192.168.1.4']) {
    const r = run({ PROD_API_URL });
    assert.equal(r.status, 1, PROD_API_URL);
    assert.match(r.stderr, /PROD_API_URL/, PROD_API_URL);
  }
});

test('production web build refuses an output dir other than apps/mobile/dist-production (it rm -rf siblings)', () => {
  for (const PROD_WEB_DIR of ['.', '..', 'apps', 'apps/mobile', '../x', 'apps/mobile/dist-preview', 'apps/mobile/dist-production/..', '/tmp/x']) {
    const r = run({ PROD_API_URL: '/api', PROD_WEB_DIR });
    assert.equal(r.status, 1, PROD_WEB_DIR);
    assert.match(r.stderr, /PROD_WEB_DIR/, PROD_WEB_DIR);
  }
  assert.equal(outProblem('apps/mobile/dist-production'), null);
});

test('check-url mirrors isPublicHost in packages/contracts (same cases)', () => {
  const bad = ['https://localhost', 'https://localhost.', 'https://app.localhost', 'https://127.1', 'https://0.0.0.0', 'https://10.0.2.2', 'https://172.16.0.1', 'https://192.168.1.10', 'https://169.254.1.1', 'https://100.64.0.1', 'https://[::1]', 'https://[::]', 'https://[::ffff:127.0.0.1]', 'https://[fd00::1]', 'https://[fe80::1]', 'https://2130706433'];
  for (const u of bad) assert.equal(isPublicHost(new URL(u).hostname), false, u);
  for (const u of ['https://pocketqa.optijara.ai', 'https://8.8.8.8', 'https://172.32.0.1', 'https://[2606:4700::1111]']) assert.equal(isPublicHost(new URL(u).hostname), true, u);
  assert.equal(apiProblem('/api'), null);
  assert.equal(apiProblem('https://api.pocketqa.example'), null);
});

test('check-url still checks when invoked through a symlink or a path with spaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pqa check url '));
  const link = join(dir, 'link to check-url.mjs');
  symlinkSync(join(import.meta.dirname, 'production/check-url.mjs'), link);
  const r = spawnSync(process.execPath, [link, 'api', 'http://127.0.0.1'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PROD_API_URL/);
});

// Ledger O4: the supervisor wrapper only runs a locked-down production env file.
const RUN_API = join(import.meta.dirname, 'production/run-api.sh');
const runApi = (envFile, arg) =>
  spawnSync('bash', [RUN_API, ...(arg ? [arg] : [])], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(envFile ? { POCKETQA_ENV_FILE: envFile } : {}) }, encoding: 'utf8' });

test('run-api.sh refuses a missing, in-repo, readable-by-others or non-production env file', async () => {
  const { chmodSync, writeFileSync } = await import('node:fs');
  assert.match(runApi(undefined).stderr, /POCKETQA_ENV_FILE/);
  const dir = mkdtempSync(join(tmpdir(), 'pqa-runapi-'));
  const loose = join(dir, 'loose.env');
  writeFileSync(loose, 'POCKETQA_ENV=production\n');
  chmodSync(loose, 0o644);
  assert.match(runApi(loose).stderr, /chmod 600/);
  const dev = join(dir, 'dev.env');
  writeFileSync(dev, 'POCKETQA_ENV=development\n');
  chmodSync(dev, 0o600);
  assert.match(runApi(dev).stderr, /POCKETQA_ENV=production/);
  assert.match(runApi(join(import.meta.dirname, '../.env.example')).stderr, /outside the repository/);
});

test('run-api.sh backup runs one online backup with a production env file', async () => {
  const { chmodSync, readdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'pqa-runapi-'));
  const data = join(dir, 'data');
  const backups = join(dir, 'backups');
  // Placeholder values only: loadConfig validates them offline; nothing contacts a provider.
  const file = join(dir, 'production.env');
  writeFileSync(file, [
    'POCKETQA_ENV=production',
    `POCKETQA_DATA_DIR=${data}`,
    `POCKETQA_BACKUP_DIR=${backups}`,
    'POCKETQA_AUTH_MODE=firebase',
    'POCKETQA_FIREBASE_PROJECT_ID=pocketqa-optijara',
    'POCKETQA_FIREBASE_WEB_API_KEY=placeholder-public-key', // check-secrets: allow (placeholder)
    'POCKETQA_PUBLIC_ORIGIN=https://pocketqa.example',
    'POCKETQA_STORAGE=r2',
    `POCKETQA_R2_ACCOUNT_ID=${'a'.repeat(32)}`,
    'POCKETQA_R2_BUCKET=pocketqa-evidence',
    'POCKETQA_R2_ACCESS_KEY_ID=placeholder',
    'POCKETQA_R2_SECRET_ACCESS_KEY=placeholder', // check-secrets: allow (placeholder)
    'POCKETQA_R2_ALLOW_DELETE=1',
  ].join('\n'));
  chmodSync(file, 0o600);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(data);
  // A database must exist: create one through the API package's own migration code.
  const mk = spawnSync('npx', ['tsx', '-e', `import('./src/db.ts').then(m => m.openDb(${JSON.stringify(join(data, 'pocketqa.sqlite'))}).close())`], { cwd: join(import.meta.dirname, '../apps/api'), encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  const r = runApi(file, 'backup');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sha256=[0-9a-f]{64}/);
  assert.equal(readdirSync(backups).length, 1);
});

test('run-api.sh reads the env file literally: shell in a value is never run, junk lines are refused (inc4 review P3-4)', async () => {
  const { chmodSync, existsSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'pqa-runapi-lit-'));
  const marker = join(dir, 'pwned');
  const file = join(dir, 'x.env');
  writeFileSync(file, `POCKETQA_NOTE=$(touch ${marker})\nPOCKETQA_OTHER=\`touch ${marker}\`\nPOCKETQA_ENV=development\n`);
  chmodSync(file, 0o600);
  assert.match(runApi(file).stderr, /POCKETQA_ENV=production/);
  assert.equal(existsSync(marker), false);
  const junk = join(dir, 'junk.env');
  writeFileSync(junk, 'POCKETQA_ENV=production\nexport rm -rf /\n');
  chmodSync(junk, 0o600);
  assert.match(runApi(junk).stderr, /isn't KEY=VALUE/);
});

test('run-api.sh accepts only Pocket QA keys (inc4 r2 P3-3)', async () => {
  const { chmodSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'pqa-runapi-keys-'));
  for (const bad of ['NODE_OPTIONS=--require /tmp/x.js', 'PATH=/tmp', 'DYLD_INSERT_LIBRARIES=/tmp/x.dylib']) {
    const file = join(dir, 'k.env');
    writeFileSync(file, `POCKETQA_ENV=production\n${bad}\n`);
    chmodSync(file, 0o600);
    assert.match(runApi(file).stderr, /not a Pocket QA setting/, bad);
  }
});

test('the runbook env example parses as data: no inline comments, only accepted keys (inc4 r2 P3-1)', async () => {
  const { readFileSync } = await import('node:fs');
  const md = readFileSync(join(import.meta.dirname, '../docs/deploy/production-runbook.md'), 'utf8');
  const block = /## 2\. The env file[\s\S]*?```sh\n([\s\S]*?)```/.exec(md)?.[1];
  assert.ok(block, 'runbook env block not found');
  const lines = block.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length >= 10);
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    assert.match(key, /^(POCKETQA_[A-Z0-9_]+|GOOGLE_APPLICATION_CREDENTIALS)$/, line);
    assert.doesNotMatch(rest.join('='), /\s#/, `inline comment would become part of the value: ${line}`);
  }
});
