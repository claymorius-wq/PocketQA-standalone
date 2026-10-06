import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEVNET_RPC_ORIGIN, vercelConfig } from './vercel/config.mjs';

// The devnet build's app CSP allows the pinned devnet RPC (pqa-be1 CS3); production and staging
// builds are byte-identical to before.
const ACCOUNT = 'a'.repeat(32);
const BUCKET = 'pocketqa-evidence';
const cspOf = (cfg) => cfg.routes[0].headers['content-security-policy'];

describe('devnet-only connect-src for the pinned devnet RPC', () => {
  for (const google of [undefined, 'pocketqa-optijara.firebaseapp.com']) {
    it(`non-devnet output is byte-identical and never names the devnet RPC (google sign-in ${google ? 'on' : 'off'})`, () => {
      const before = JSON.stringify(vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET, googleAuthDomain: google }));
      assert.equal(JSON.stringify(vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET, googleAuthDomain: google, devnet: false })), before);
      assert.ok(!before.includes(DEVNET_RPC_ORIGIN));
    });
  }

  it('the devnet build adds exactly that origin to the app connect-src, nothing else changes', () => {
    const base = vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET });
    const dev = vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET, devnet: true });
    const connect = (csp) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
    assert.equal(connect(cspOf(dev)), `${connect(cspOf(base))} ${DEVNET_RPC_ORIGIN}`);
    assert.equal(cspOf(dev).replace(` ${DEVNET_RPC_ORIGIN}`, ''), cspOf(base));
    assert.deepEqual(dev.routes.slice(1), base.routes.slice(1)); // the API CSP and every other route unchanged
    assert.deepEqual(dev.crons, base.crons);
    assert.equal(DEVNET_RPC_ORIGIN, 'https://api.devnet.solana.com');
  });

  it('build.mjs turns it on only for --env devnet', () => {
    const src = readFileSync(join(import.meta.dirname, 'vercel/build.mjs'), 'utf8');
    assert.match(src, /vercelConfig\(\{ r2AccountId, bucket, googleAuthDomain, devnet: envName === 'devnet' \}\)/);
  });
});
