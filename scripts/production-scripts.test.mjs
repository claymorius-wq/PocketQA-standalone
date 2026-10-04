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
