import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertBundles, bundleProblems } from './vercel/bundle-check.mjs';

// pqa-qa hosted gate r1 P1-H1: a stale Metro cache shipped the deployed web app an e2e bundle
// calling http://127.0.0.1:18887. These cover the check that now gates every web build.
const STALE = 'var a="http://127.0.0.1:18887";fetch(a+"/config");var d=`http://127.0.0.1:${8787}`;var l="http://localhost";';
const GOOD = 'var a="/api";fetch(a+"/config");var d=`http://127.0.0.1:${8787}`;var l="http://localhost";';

describe('bundle check', () => {
  it('fails the stale e2e bundle (the deployed incident), naming the private base', () => {
    assert.deepEqual(bundleProblems(STALE, '/api'), ['missing the API base /api', 'private/loopback API base http://127.0.0.1:18887']);
  });

  it('passes the same-origin bundle; bare hosts and runtime-assembled defaults are not API bases', () => {
    assert.deepEqual(bundleProblems(GOOD, '/api'), []);
  });

  it('flags every private range with a port, and the wrong https base', () => {
    for (const u of ['http://localhost:8090', 'http://[::1]:8787', 'http://10.0.2.2:8787', 'http://192.168.1.5:8787', 'http://172.20.0.1:8787', 'http://0.0.0.0:3000']) {
      assert.ok(bundleProblems(`x="${u}";y="/api"`, '/api').some((p) => p.includes(u)), u);
    }
    assert.deepEqual(bundleProblems('x="https://other.example/api"', 'https://pocketqa.vercel.app/api'), ['missing the API base https://pocketqa.vercel.app/api']);
  });

  it('assertBundles over a directory: throws for a stale tree, passes a good one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-bundle-'));
    try {
      mkdirSync(join(dir, 'js'), { recursive: true });
      writeFileSync(join(dir, 'js', 'entry.js'), STALE);
      assert.throws(() => assertBundles([dir], '/api'), /127\.0\.0\.1:18887/);
      writeFileSync(join(dir, 'js', 'entry.js'), GOOD);
      assert.equal(assertBundles([dir], '/api'), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the web export in build.mjs always clears the Metro cache and is gated by the check', () => {
    const src = readFileSync(join(import.meta.dirname, 'vercel/build.mjs'), 'utf8');
    assert.match(src, /'expo', 'export', '--platform', 'web', '--output-dir', 'dist-web', '--clear'/);
    assert.match(src, /assertBundles\(\[join\(staticDir, '_expo'\)\], '\/api'\)/);
  });

  it('Hermes bytecode (APK): unquoted strings; RN dev server and Solana localnet constants are not API bases', () => {
    const magic = '\xc6\x1f\xbc\x03\xc1\x03\x19\x1f';
    const hermes = `${magic}abchttps://pocketqa.vercel.app/apixyzhttp://localhost:8081http://localhost:88991ptb`;
    assert.deepEqual(bundleProblems(hermes, 'https://pocketqa.vercel.app/api'), []);
    assert.deepEqual(bundleProblems(`${magic}http://127.0.0.1:18887abc`, 'https://pocketqa.vercel.app/api'), ['missing the API base https://pocketqa.vercel.app/api', 'private/loopback API base http://127.0.0.1:18887']);
  });
});
