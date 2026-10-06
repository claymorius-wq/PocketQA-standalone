import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// pqa-qa r7 P3: a deploy build refuses unless every server-only value is present to scan.
const BUILD = join(import.meta.dirname, 'vercel/build.mjs');
const base = { PATH: process.env.PATH, HOME: process.env.HOME, POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32), POCKETQA_R2_BUCKET: 'pqa-test' };
const run = (args, env) => spawnSync(process.execPath, [BUILD, ...args], { env: { ...base, ...env }, encoding: 'utf8' });

describe('vercel build --deploy', () => {
  it('refuses when a server-only variable is missing, naming it, before writing anything', () => {
    const r = run(['--deploy'], { POCKETQA_R2_ACCESS_KEY_ID: 'x'.repeat(16), POCKETQA_R2_SECRET_ACCESS_KEY: 'y'.repeat(16), CRON_SECRET: 'z'.repeat(40) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: FIREBASE_SERVICE_ACCOUNT_JSON/);
  });

  it('refuses --deploy with --skip-web', () => {
    const r = run(['--deploy', '--skip-web'], {});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /drop --skip-web/);
  });

  it('the scan refuses (and deletes) an output that contains a server-only value', () => {
    // A stand-in "secret" that the output is known to contain (a header name in config.json).
    const r = run(['--skip-web'], { CRON_SECRET: 'x-content-type-options' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /secret scan: \d+ match/);
    assert.equal(spawnSync('test', ['-e', join(import.meta.dirname, '../.vercel/output')]).status, 1);
  });
});
