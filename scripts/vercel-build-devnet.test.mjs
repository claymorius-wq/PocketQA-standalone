import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { base58, needlesFor } from './vercel/secret-needles.mjs';

// devnet-phase-contract.md CH-D4: the platform signer is a server-only variable of the devnet
// (Preview) build only. Every other build refuses to run with it; the scan looks for its bytes in
// every encoding a bundle could carry. Values are synthetic and never printed.
const BUILD = join(import.meta.dirname, 'vercel/build.mjs');
const base = { PATH: process.env.PATH, HOME: process.env.HOME, POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32), POCKETQA_R2_BUCKET: 'pqa-test' };
const run = (args, env) => spawnSync(process.execPath, [BUILD, ...args], { env: { ...base, ...env }, encoding: 'utf8' });
const fakeKey = JSON.stringify(Array.from(randomBytes(64)));

describe('vercel build: the devnet platform signer', () => {
  for (const env of ['production', 'staging']) {
    it(`a ${env} build refuses to run with the signer in its environment, never printing it`, () => {
      const r = run(['--env', env, '--skip-web', '--out', '/nonexistent/never-written'], { POCKETQA_DEVNET_PLATFORM_SIGNER: fakeKey });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /POCKETQA_DEVNET_PLATFORM_SIGNER is only for --env devnet builds/);
      assert.ok(!r.stderr.includes(fakeKey) && !r.stdout.includes(fakeKey));
    });
  }

  it('a devnet --deploy needs the signer present to scan for it (named, not shown)', () => {
    const r = run(['--env', 'devnet', '--deploy'], { // check-secrets: allow (fake values; the run refuses before building)
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}', POCKETQA_R2_ACCESS_KEY_ID: 'x'.repeat(16), POCKETQA_R2_SECRET_ACCESS_KEY: 'y'.repeat(16), CRON_SECRET: 'z'.repeat(40) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: POCKETQA_DEVNET_PLATFORM_SIGNER/);
  });

  it('a production --deploy does not need it', () => {
    const r = run(['--env', 'production', '--deploy'], { // check-secrets: allow (fake values; the run refuses before building)
      POCKETQA_R2_ACCESS_KEY_ID: 'x'.repeat(16), POCKETQA_R2_SECRET_ACCESS_KEY: 'y'.repeat(16), CRON_SECRET: 'z'.repeat(40) });
    assert.match(r.stderr, /missing: FIREBASE_SERVICE_ACCOUNT_JSON\)/);
    assert.doesNotMatch(r.stderr, /POCKETQA_DEVNET_PLATFORM_SIGNER/);
  });

  it('the scan looks for the key and its seed as JSON, hex, base64, base58 and comma lists', () => {
    const bytes = Array.from(randomBytes(64));
    const n = needlesFor('POCKETQA_DEVNET_PLATFORM_SIGNER', JSON.stringify(bytes));
    for (const part of [bytes, bytes.slice(0, 32)]) {
      const buf = Buffer.from(part);
      for (const enc of [buf.toString('hex'), buf.toString('base64'), base58(Uint8Array.from(part)), part.join(',')]) assert.ok(n.includes(enc));
    }
    assert.ok(n.includes(JSON.stringify(bytes)));
  });

  it('base58 matches the Solana alphabet (leading zero bytes become 1s)', () => {
    assert.equal(base58(Uint8Array.from([0, 0, 1])), '112');
    assert.equal(base58(Uint8Array.from(Buffer.from('hello world'))), 'StV1DL6CwTryKyV');
  });
});
