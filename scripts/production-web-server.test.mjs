// Production web front door: static build with SPA fallback, same-origin /api proxy that keeps
// the bearer token and drops cookies, Host pinning, and the exact CSP. Ephemeral ports only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { appCsp, connectOrigins, createWebServer } from './production/web-server.mjs';

const HOST = 'app.example.test';
const ACCOUNT = 'a'.repeat(32);
let web, upstream, webPort, root;
const seen = [];

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
function http(method, path, { host = HOST, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: webPort, method, path, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'pqa-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(root, '_expo'));
  writeFileSync(join(root, '_expo', 'app.js'), 'console.log(1)');
  // A decoy next to the root: traversal must never reach it.
  writeFileSync(join(root, '..', `${root.split('/').pop()}-secret.txt`), 'secret');
  upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(req.url.startsWith('/media/') ? 206 : 200, { 'content-type': 'application/json', 'set-cookie': 'x=1', 'content-range': 'bytes 0-1/10' });
      res.end('{"ok":true}');
    });
  });
  const upPort = await listen(upstream);
  web = createWebServer({ root, apiOrigin: `http://127.0.0.1:${upPort}`, allowedHosts: [HOST], connect: connectOrigins(ACCOUNT, 'pocketqa-evidence') });
  webPort = await listen(web);
});
after(() => {
  web.close();
  upstream.close();
});

describe('production web server', () => {
  it('refuses other Host headers (421)', async () => {
    assert.equal((await http('GET', '/', { host: 'evil.example' })).status, 421);
  });

  it('serves the app with the exact CSP, security headers and an uncached index', async () => {
    const r = await http('GET', '/studies/123');
    assert.equal(r.status, 200);
    assert.match(r.body, /<title>app<\/title>/); // SPA fallback
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['strict-transport-security'], /max-age=31536000/);
    const csp = r.headers['content-security-policy'];
    assert.match(csp, /script-src 'self';/);
    // R2 narrowed to the one bucket's path.
    assert.match(csp, new RegExp(`connect-src 'self' https://identitytoolkit\\.googleapis\\.com https://securetoken\\.googleapis\\.com https://${ACCOUNT}\\.r2\\.cloudflarestorage\\.com/pocketqa-evidence/;`));
    assert.doesNotMatch(csp, /\*/);
    const asset = await http('GET', '/_expo/app.js');
    assert.equal(asset.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(asset.headers['cache-control'], 'public, max-age=300');
  });

  it('never serves files outside the root and refuses non-GET static requests', async () => {
    const r = await http('GET', `/../${root.split('/').pop()}-secret.txt`);
    assert.doesNotMatch(r.body, /secret/);
    assert.equal((await http('POST', '/index.html')).status, 405);
  });

  it('has no preview gate, demo bootstrap or preview block list', async () => {
    const boot = await http('GET', '/__preview/bootstrap.json');
    assert.match(boot.body, /<title>app<\/title>/); // just the SPA, never demo sign-ins
    seen.length = 0;
    const up = await http('POST', '/api/participations/p1/evidence/upload-intents', { headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(up.status, 200);
    assert.equal(seen[0].url, '/participations/p1/evidence/upload-intents');
  });

  it('proxies /api with the bearer token, without cookies either way, under the API CSP', async () => {
    seen.length = 0;
    const r = await http('GET', '/api/me?x=1', { headers: { authorization: 'Bearer tok', cookie: 'a=b', connection: 'x-drop', 'x-drop': '1' } });
    assert.equal(r.status, 200);
    assert.equal(seen[0].url, '/me?x=1');
    assert.equal(seen[0].headers.authorization, 'Bearer tok');
    assert.equal(seen[0].headers.cookie, undefined);
    assert.equal(seen[0].headers['x-drop'], undefined);
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.headers['content-security-policy'], "default-src 'none'; sandbox");
  });

  it('states the client address itself and drops client-supplied forwarding headers', async () => {
    seen.length = 0;
    const spoof = { 'x-forwarded-for': '6.6.6.6', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http', forwarded: 'for=6.6.6.6', 'x-real-ip': '6.6.6.6' };
    // Behind the tunnel (loopback peer): the visitor from CF-Connecting-IP.
    await http('GET', '/api/me', { headers: { ...spoof, 'cf-connecting-ip': '203.0.113.7' } });
    // A garbage CF-Connecting-IP falls back to the socket peer.
    await http('GET', '/api/me', { headers: { ...spoof, 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' } });
    assert.equal(seen[0].headers['x-forwarded-for'], '203.0.113.7');
    assert.equal(seen[1].headers['x-forwarded-for'], '127.0.0.1');
    for (const h of seen.map((x) => x.headers)) {
      for (const k of ['x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip']) assert.equal(h[k], undefined, k);
    }
  });

  it('passes ranged media through (206 with Content-Range)', async () => {
    const r = await http('GET', '/api/media/tok', { headers: { range: 'bytes=0-1' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers['content-range'], 'bytes 0-1/10');
    assert.equal(seen.at(-1).headers.range, 'bytes=0-1');
  });

  it('refuses non-canonical API paths (400)', async () => {
    for (const p of ['/api/me%2F', '/api/a//b', '/api/a/../me', '/api/me;x', '/api/a\\b']) assert.equal((await http('GET', p)).status, 400, p);
  });

  it('answers 502 when the API is down', async () => {
    const dead = createWebServer({ root, apiOrigin: 'http://127.0.0.1:1', allowedHosts: [HOST], connect: [] });
    const port = await listen(dead);
    const r = await new Promise((resolve) => {
      request({ hostname: '127.0.0.1', port, path: '/api/me', headers: { host: HOST } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }).end();
    });
    dead.close();
    assert.equal(r, 502);
  });

  it('refuses a non-loopback API, a missing build, and loose connect-src values', () => {
    assert.throws(() => createWebServer({ root, apiOrigin: 'http://10.0.0.1:8787', allowedHosts: [HOST], connect: [] }), /loopback/);
    assert.throws(() => createWebServer({ root: mkdtempSync(join(tmpdir(), 'pqa-empty-')), apiOrigin: 'http://127.0.0.1:1', allowedHosts: [HOST], connect: [] }), /index\.html/);
    assert.throws(() => connectOrigins('nothex', 'pocketqa-evidence'), /32 hex/);
    assert.throws(() => connectOrigins(ACCOUNT, ''), /bucket/);
    for (const o of ['https://*.r2.cloudflarestorage.com', 'http://x.example', 'https://x.example/path', 'https://x.example/a/b/', "https://x.example; script-src *", "https://x.example/b/ 'unsafe-eval'"]) assert.throws(() => appCsp([o]), /https origin/, o);
  });
});
