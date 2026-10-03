// Preview scripts: password rotation via stdin invalidates old gate sessions and prints no
// secret; the convenience writer refuses a password that doesn't match the gate hash.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { signSession, verifyPassword, verifySession } from './preview/gate-server.mjs';

const dir = import.meta.dirname;
// State folders must live under the git-ignored .preview-test/ (see paths.mjs).
const TEST_ROOT = join(dir, '..', '.preview-test');
mkdirSync(TEST_ROOT, { recursive: true, mode: 0o700 });
const made = [];
const tempState = () => {
  const d = mkdtempSync(join(TEST_ROOT, 'unit-'));
  made.push(d);
  return d;
};
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const run = (script, args, input, env) => spawnSync(process.execPath, [join(dir, 'preview', script), ...args], { input, env: { ...process.env, ...env }, encoding: 'utf8' });

test('state folder overrides are limited to .preview or .preview-test/ (review r1 P3)', () => {
  // An invalid stdin password too, so even if the folder check regressed, nothing is written.
  for (const bad of ['docs', 'apps/mobile', '.preview-test', '.preview-test/../docs', '/tmp/x']) {
    const r = run('init-preview.mjs', ['--rotate', '--password-stdin'], 'has space', { PREVIEW_STATE_DIR: bad });
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /PREVIEW_STATE_DIR must be/);
  }
});

test('rotate with --password-stdin: new hash and cookie key, old sessions rejected, nothing printed', async () => {
  const state = tempState();
  const env = { PREVIEW_STATE_DIR: state };
  const first = randomBytes(12).toString('base64url');
  const second = randomBytes(12).toString('base64url');
  const r1 = run('init-preview.mjs', ['--password-stdin'], `${first}\n`, env);
  assert.equal(r1.status, 0);
  assert.ok(!r1.stdout.includes(first) && !r1.stderr.includes(first));
  const s1 = JSON.parse(readFileSync(join(state, 'gate-secret.json'), 'utf8'));
  assert.ok(await verifyPassword(first, s1));
  const oldCookie = signSession(Buffer.from(s1.cookieKey, 'base64'), Date.now());

  assert.equal(run('init-preview.mjs', ['--password-stdin'], `${second}\n`, env).status, 0, 'no-op without --rotate');
  assert.ok(await verifyPassword(first, JSON.parse(readFileSync(join(state, 'gate-secret.json'), 'utf8'))));

  const r2 = run('init-preview.mjs', ['--rotate', '--password-stdin'], `${second}\n`, env);
  assert.equal(r2.status, 0);
  assert.ok(!r2.stdout.includes(second));
  const s2 = JSON.parse(readFileSync(join(state, 'gate-secret.json'), 'utf8'));
  assert.ok(await verifyPassword(second, s2));
  assert.ok(!(await verifyPassword(first, s2)));
  assert.notEqual(s2.cookieKey, s1.cookieKey);
  assert.notEqual(s2.salt, s1.salt);
  assert.ok(!verifySession(Buffer.from(s2.cookieKey, 'base64'), oldCookie, Date.now()), 'old gate session invalid after rotation');
  for (const f of ['gate-secret.json', 'access.txt']) assert.equal(statSync(join(state, f)).mode & 0o777, 0o600, f);
  assert.match(readFileSync(join(state, 'access.txt'), 'utf8'), new RegExp(`^Gate password: ${second}$`, 'm'));
  assert.equal(run('init-preview.mjs', ['--rotate', '--password-stdin'], 'has space\n', env).status, 2);
});

test('enable-convenience: refuses a wrong password, writes a 0600 file of synthetic sign-ins, prints nothing secret', () => {
  const state = tempState();
  const env = { PREVIEW_STATE_DIR: state };
  const gate = randomBytes(12).toString('base64url');
  assert.equal(run('init-preview.mjs', ['--password-stdin'], gate, env).status, 0);
  const pw = () => randomBytes(18).toString('base64url');
  const demo = { Tester: pw(), Builder: pw(), Admin: pw() };
  writeFileSync(
    join(state, 'access.txt'),
    `${readFileSync(join(state, 'access.txt'), 'utf8')}\nDemo accounts\n${Object.entries(demo).map(([k, v]) => `${k}:${' '.repeat(9 - k.length)}demo-${k.toLowerCase()}@pocketqa.example  /  ${v}`).join('\n')}\n`,
  );
  const wrong = run('enable-convenience.mjs', [], 'not-the-gate-password', env);
  assert.equal(wrong.status, 2);
  assert.ok(!existsSync(join(state, 'convenience.json')));
  const ok = run('enable-convenience.mjs', [], gate, env);
  assert.equal(ok.status, 0, ok.stderr);
  for (const v of [gate, ...Object.values(demo)]) assert.ok(!ok.stdout.includes(v));
  const f = join(state, 'convenience.json');
  assert.equal(statSync(f).mode & 0o777, 0o600);
  const c = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(c.gatePrefill, gate);
  assert.deepEqual(c.demoAccounts.map((a) => a.email), ['demo-tester@pocketqa.example', 'demo-builder@pocketqa.example', 'demo-admin@pocketqa.example']);
  assert.equal(run('enable-convenience.mjs', ['--off'], '', env).status, 0);
  assert.ok(!existsSync(f));
});

test('start.sh pins the shared demo to local auth and local storage (cloud review r1 P2)', () => {
  // The API merges .env.local into its config; the process environment wins, so the
  // preview launcher sets these explicitly on the API command.
  const sh = readFileSync(join(dir, 'preview', 'start.sh'), 'utf8');
  const api = sh.split('\n').find((l) => l.includes('POCKETQA_API_PORT=')) ?? '';
  for (const kv of ['POCKETQA_SHARED_DEMO=1', 'POCKETQA_AUTH_MODE=local', 'POCKETQA_STORAGE=local']) assert.ok(api.includes(kv), kv);
});
