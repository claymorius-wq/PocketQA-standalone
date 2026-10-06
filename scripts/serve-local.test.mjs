import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { API_CSP, securityHeaders } from './production/security-headers.mjs';
import { checkRoutes, parseTestConnect, resolveRoute, serveLocal, withTestConnect } from './vercel/serve-local.mjs';
import { hostedAppCsp, vercelConfig } from './vercel/config.mjs';

// scripts/vercel/serve-local.mjs: the local rehearsal of a built .vercel/output follows config.json
// exactly, and its only test hook (--test-connect) accepts nothing but a loopback http origin.
const ACCOUNT = 'a'.repeat(32);
const cfg = vercelConfig({ r2AccountId: ACCOUNT, bucket: 'pqa-test' });
const FILES = new Set(['/index.html', '/_expo/static/js/web/entry.js', '/assets/icon.png']);
const has = (p) => FILES.has(p);

describe('route resolution (config.json semantics)', () => {
  it('documents get the app CSP and fall back to the SPA; real files are served as themselves', () => {
    for (const p of ['/', '/sign-in', '/studies/abc', '/apiary']) {
      const r = resolveRoute(cfg, p, has);
      assert.deepEqual(r.target, { kind: 'static', file: '/index.html' }, p);
      assert.equal(r.headers['content-security-policy'], hostedAppCsp(ACCOUNT, 'pqa-test'), p);
      for (const [k, v] of Object.entries(securityHeaders())) assert.equal(r.headers[k], v, `${p} ${k}`);
    }
    const js = resolveRoute(cfg, '/_expo/static/js/web/entry.js', has);
    assert.deepEqual(js.target, { kind: 'static', file: '/_expo/static/js/web/entry.js' });
  });

  it('/api and /api/* go to the function with the sandbox CSP and no-store; nothing else does', () => {
    for (const p of ['/api', '/api/config', '/api/jobs/sweep']) {
      const r = resolveRoute(cfg, p, has);
      assert.deepEqual(r.target, { kind: 'function' }, p);
      assert.equal(r.headers['content-security-policy'], API_CSP, p);
      assert.equal(r.headers['cache-control'], 'no-store', p);
      for (const [k, v] of Object.entries(securityHeaders())) assert.equal(r.headers[k], v, `${p} ${k}`);
    }
    assert.notDeepEqual(resolveRoute(cfg, '/apiary', has).target, { kind: 'function' });
  });

  it('refuses route shapes it does not implement', () => {
    assert.throws(() => checkRoutes({ version: 3, routes: [{ handle: 'miss' }] }), /filesystem/);
    assert.throws(() => checkRoutes({ version: 3, routes: [{ src: '/x', status: 301 }] }), /"status" is not implemented/);
    assert.throws(() => checkRoutes({ version: 2, routes: [] }), /v3/);
    assert.doesNotThrow(() => checkRoutes(cfg));
  });
});

describe('--test-connect', () => {
  it('accepts only an exact loopback http origin', () => {
    assert.equal(parseTestConnect('http://127.0.0.1:9399'), 'http://127.0.0.1:9399');
    assert.equal(parseTestConnect('http://localhost:9399'), 'http://localhost:9399');
    for (const bad of ['https://127.0.0.1:9399', 'http://10.0.0.2:9399', 'http://example.com', 'http://127.0.0.1:9399/', 'http://127.0.0.1:9399/x', 'http://u:p@127.0.0.1:9399', '*', 'http://127.0.0.1.nip.io:9399', '']) {
      assert.throws(() => parseTestConnect(bad), /loopback http origin/, bad);
    }
  });

  it('appends to the app connect-src only, in memory', () => {
    const t = withTestConnect(cfg, 'http://127.0.0.1:9399');
    const csp = t.routes[0].headers['content-security-policy'];
    assert.match(csp, /connect-src 'self' [^;]* http:\/\/127\.0\.0\.1:9399;/);
    assert.equal(csp.replace(' http://127.0.0.1:9399', ''), cfg.routes[0].headers['content-security-policy']);
    assert.equal(t.routes[1].headers['content-security-policy'], API_CSP);
    assert.ok(!cfg.routes[0].headers['content-security-policy'].includes('9399'), 'the original config is untouched');
  });
});

describe('serving a built output', () => {
  let dir;
  let server;
  let before_;
  const port = 18000 + Math.floor(Math.random() * 2000);
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pqa-serve-local-'));
    mkdirSync(join(dir, 'static'), { recursive: true });
    mkdirSync(join(dir, 'functions/api.func'), { recursive: true });
    writeFileSync(join(dir, 'static/index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(dir, 'functions/api.func/index.mjs'), "export default (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: req.url })); };");
    writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
    before_ = { text: readFileSync(join(dir, 'config.json'), 'utf8'), mtime: statSync(join(dir, 'config.json')).mtimeMs };
    server = await serveLocal({ dir, port, testConnect: 'http://127.0.0.1:9399' });
  });
  after(() => server?.close());

  it('serves the SPA and the function with their route headers; config.json is never written', async () => {
    const page = await fetch(`http://127.0.0.1:${port}/sign-in`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>app<\/title>/);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self' .* http:\/\/127\.0\.0\.1:9399;/);
    const api = await fetch(`http://127.0.0.1:${port}/api/config?x=1`);
    assert.deepEqual(await api.json(), { url: '/api/config?x=1' }); // the original URL, as Vercel passes it
    assert.equal(api.headers.get('content-security-policy'), API_CSP);
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before_.text);
    assert.equal(statSync(join(dir, 'config.json')).mtimeMs, before_.mtime);
  });

  it('refuses the reserved API port and a non-loopback test origin', async () => {
    await assert.rejects(serveLocal({ dir, port: 8787 }), /other than 8787/);
    await assert.rejects(serveLocal({ dir, port: port + 1, testConnect: 'https://evil.example' }), /loopback http origin/);
  });
});
