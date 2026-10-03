// Preview gate: every resource is gated, the proxy keeps the app's bearer token and drops
// the gate cookie, and the cookie is HttpOnly/Secure/SameSite=Strict. Ephemeral ports only.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { COOKIE, createGateServer, hashPassword, loadConvenience, loadSecret, signSession, verifySession } from './preview/gate-server.mjs';

const PASSWORD = randomBytes(18).toString('base64url'); // generated per run, never printed
const HOST = 'preview.example.test';
let gate, upstream, gatePort, upstreamPort, root, clock;
const seen = [];

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

function http(method, path, { host = HOST, headers = {}, body, port = gatePort } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const form = (password, extra = {}) => ({ headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams({ password }).toString() });

async function signIn() {
  const r = await http('POST', '/__gate/login', form(PASSWORD, { origin: `https://${HOST}`, 'cf-connecting-ip': '203.0.113.9' }));
  assert.equal(r.status, 303);
  return r.headers['set-cookie'][0].split(';')[0];
}

before(async () => {
  // A decoy file next to the web root: a traversal bug would serve it.
  const base = mkdtempSync(join(tmpdir(), 'pqa-gate-web-'));
  writeFileSync(join(base, 'package.json'), '{"name":"OUTSIDE_WEB_ROOT"}');
  root = join(base, 'web');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title><div id="root">APP_INDEX</div>');
  mkdirSync(join(root, '_expo'));
  writeFileSync(join(root, '_expo', 'bundle.js'), 'console.log("APP_BUNDLE")');
  upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream=1', 'x-upstream': 'yes' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  upstreamPort = await listen(upstream);
  clock = { t: Date.now() };
  const { salt, hash } = hashPassword(PASSWORD);
  gate = createGateServer({
    root,
    apiOrigin: `http://127.0.0.1:${upstreamPort}`,
    allowedHosts: [HOST],
    secret: { salt, hash, cookieKey: randomBytes(32).toString('base64') },
    now: () => clock.t,
  });
  gatePort = await listen(gate);
});

after(() => {
  gate.close();
  upstream.close();
});

describe('preview gate: nothing is served without the gate cookie', () => {
  it('rejects requests for any other Host (421)', async () => {
    assert.equal((await http('GET', '/', { host: 'evil.example' })).status, 421);
    assert.equal((await http('GET', '/__gate/login', { host: 'evil.example' })).status, 421);
  });

  it('redirects pages and assets to the login page, and returns 401 for the API', async () => {
    for (const p of ['/', '/index.html', '/_expo/bundle.js', '/builder/review/x', '/__gate/logout']) {
      const r = await http('GET', p);
      assert.equal(r.status, 303, p);
      assert.equal(r.headers.location, '/__gate/login');
      assert.ok(!r.body.includes('APP_'), p);
    }
    for (const [m, p] of [['GET', '/api/health'], ['POST', '/api/auth/login'], ['GET', '/api'], ['DELETE', '/api/me']]) {
      const r = await http(m, p, { headers: { authorization: 'Bearer some-app-token' } });
      assert.equal(r.status, 401, `${m} ${p}`);
      assert.deepEqual([JSON.parse(r.body).code, JSON.parse(r.body).gate], ['UNAUTHENTICATED', true]);
    }
    assert.equal(seen.length, 0, 'nothing reached the API');
  });

  it('serves the login page with a strict CSP and an identity marker', async () => {
    const r = await http('GET', '/__gate/login');
    assert.equal(r.status, 200);
    assert.match(r.body, /name="pocketqa-preview" content="gate"/);
    assert.match(r.body, /shared with other viewers/);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['strict-transport-security'], /max-age=/);
  });
});

describe('preview gate: login', () => {
  it('refuses a cross-site login POST (403)', async () => {
    const r = await http('POST', '/__gate/login', form(PASSWORD, { origin: 'https://evil.example' }));
    assert.equal(r.status, 403);
    assert.equal(r.headers['set-cookie'], undefined);
  });

  it('rejects a wrong password, then rate-limits that client even with the right one', async () => {
    const ip = { 'cf-connecting-ip': '198.51.100.7' };
    for (let i = 0; i < 10; i += 1) {
      const r = await http('POST', '/__gate/login', form('wrong-password', ip));
      assert.equal(r.status, 401);
      assert.equal(r.headers['set-cookie'], undefined);
    }
    const blocked = await http('POST', '/__gate/login', form(PASSWORD, ip));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers['set-cookie'], undefined);
    // Another client is unaffected.
    assert.equal((await http('POST', '/__gate/login', form(PASSWORD, { 'cf-connecting-ip': '192.0.2.1' }))).status, 303);
  });

  it('sets a __Host- cookie that is HttpOnly, Secure, SameSite=Strict, Path=/, no Domain', async () => {
    const r = await http('POST', '/__gate/login', form(PASSWORD, { origin: `https://${HOST}` }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/');
    const c = r.headers['set-cookie'][0];
    assert.ok(c.startsWith(`${COOKIE}=v1.`));
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(attr), attr);
    assert.ok(!/domain=/i.test(c));
  });

  it('ignores an oversized login body', async () => {
    const r = await http('POST', '/__gate/login', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${'x'.repeat(5000)}` }).catch(() => ({ status: 0 }));
    assert.notEqual(r.status, 303);
  });
});

describe('preview gate: with a valid cookie', () => {
  it('serves the app, with SPA fallback and no path traversal', async () => {
    const cookie = await signIn();
    const home = await http('GET', '/', { headers: { cookie } });
    assert.equal(home.status, 200);
    assert.match(home.body, /APP_INDEX/);
    assert.match(home.headers['content-security-policy'], /connect-src 'self'/);
    assert.match((await http('GET', '/_expo/bundle.js', { headers: { cookie } })).body, /APP_BUNDLE/);
    assert.match((await http('GET', '/builder/review/abc', { headers: { cookie } })).body, /APP_INDEX/);
    for (const p of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/..%2f..%2fpackage.json']) {
      const r = await http('GET', p, { headers: { cookie } });
      assert.ok(r.status === 200 || r.status === 400, p);
      assert.ok(!r.body.includes('OUTSIDE_WEB_ROOT'), `${p} leaked a file outside the web root`);
    }
    assert.equal((await http('POST', '/', { headers: { cookie } })).status, 405);
  });

  it('proxies /api to the loopback API: path stripped, bearer kept, gate cookie and upstream cookies dropped', async () => {
    const cookie = await signIn();
    seen.length = 0;
    const r = await http('POST', '/api/auth/login?x=1', {
      headers: { cookie: `${cookie}; other=1`, authorization: 'Bearer app-session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.test' }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.headers['x-upstream'], 'yes');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/auth/login?x=1');
    assert.equal(seen[0].headers.authorization, 'Bearer app-session-token');
    assert.equal(seen[0].headers.cookie, undefined);
    assert.equal(seen[0].headers.host, `127.0.0.1:${upstreamPort}`);
    assert.equal(seen[0].body, JSON.stringify({ email: 'a@example.test' }));
    const q = await http('GET', '/api?y=2', { headers: { cookie } });
    assert.equal(JSON.parse(q.body).url, '/?y=2');
  });

  it('rejects tampered and expired cookies, and logout clears the cookie', async () => {
    const cookie = await signIn();
    const [name, value] = cookie.split('=');
    const tampered = `${name}=${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`;
    assert.equal((await http('GET', '/api/health', { headers: { cookie: tampered } })).status, 401);
    const forged = value.replace(/^v1\.\d+/, `v1.${Math.floor(clock.t / 1000) + 10 ** 7}`);
    assert.equal((await http('GET', '/api/health', { headers: { cookie: `${name}=${forged}` } })).status, 401, 'extended expiry must break the HMAC');
    clock.t += 13 * 3600 * 1000;
    assert.equal((await http('GET', '/', { headers: { cookie } })).status, 303, 'expired after 12 h');
    clock.t -= 13 * 3600 * 1000;
    const out = await http('POST', '/__gate/logout', { headers: { cookie } });
    assert.equal(out.status, 303);
    assert.match(out.headers['set-cookie'][0], /Max-Age=0/);
    // Review r1 P3: logout revokes server-side, so a copied cookie stops working too.
    assert.equal((await http('GET', '/api/health', { headers: { cookie } })).status, 401);
  });

  it('returns 502 JSON when the API is down', async () => {
    const cookie = await signIn();
    const dead = createGateServer({
      root,
      apiOrigin: 'http://127.0.0.1:9',
      allowedHosts: [HOST],
      secret: { ...hashPassword(PASSWORD), cookieKey: randomBytes(32).toString('base64') },
    });
    const port = await listen(dead);
    const fresh = await http('POST', '/__gate/login', { ...form(PASSWORD), port });
    const c = fresh.headers['set-cookie'][0].split(';')[0];
    const r = await http('GET', '/api/health', { headers: { cookie: c }, port });
    dead.close();
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(r.body).code, 'INTERNAL');
    assert.ok(cookie);
  });
});

describe('preview gate: shared-preview policy (review r1 P2)', () => {
  it('refuses uploads, account deletion and admin moderation without reaching the API', async () => {
    const cookie = await signIn();
    seen.length = 0;
    for (const [m, p] of [
      ['POST', '/api/participations/p1/evidence'],
      ['POST', '/api/participations/p1/evidence/'],
      ['DELETE', '/api/me'],
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/identity/session'],
      ['POST', '/api/auth/wallet/challenge'],
      ['POST', '/api/auth/wallet/login'],
      ['POST', '/api/admin/moderation/users/u1'],
      ['POST', '/api/admin/moderation/studies/s1'],
    ]) {
      const r = await http(m, p, { headers: { cookie, authorization: 'Bearer t', 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 403, `${m} ${p}`);
      const body = JSON.parse(r.body);
      assert.equal(body.code, 'FORBIDDEN_ROLE');
      assert.match(body.message, /preview/);
    }
    assert.equal(seen.length, 0);
  });

  it('rejects encoded, dot-segment and doubled-slash spellings instead of forwarding them', async () => {
    const cookie = await signIn();
    seen.length = 0;
    for (const p of ['/api/participations/p1/%65vidence', '/api/participations/p1/./evidence', '/api/participations/x/../p1/evidence', '/api//me', '/api/me%2f', '/api/me;x', '/api/participations/p1\\evidence']) {
      const r = await http('POST', p, { headers: { cookie } });
      assert.equal(r.status, 400, p);
    }
    assert.equal(seen.length, 0);
  });

  it('still forwards allowed calls on the same resources', async () => {
    const cookie = await signIn();
    seen.length = 0;
    assert.equal((await http('GET', '/api/participations/p1/evidence', { headers: { cookie } })).status, 200);
    assert.equal((await http('GET', '/api/me', { headers: { cookie } })).status, 200);
    assert.equal((await http('POST', '/api/admin/disputes/d1/resolve', { headers: { cookie }, body: '{}' })).status, 200);
    assert.equal(seen.length, 3);
  });

  it('strips headers named in Connection and sandboxes API responses', async () => {
    const cookie = await signIn();
    seen.length = 0;
    const r = await http('GET', '/api/me', { headers: { cookie, connection: 'x-private-hop', 'x-private-hop': '1' } });
    assert.equal(seen[0].headers['x-private-hop'], undefined);
    assert.match(r.headers['content-security-policy'], /default-src 'none'; sandbox/);
  });
});

describe('preview gate: login under load (review r1 P3)', () => {
  it('caps concurrent attempts so a burst cannot bypass the per-IP limit', async () => {
    const ip = { 'cf-connecting-ip': '203.0.113.77' };
    const results = await Promise.all(Array.from({ length: 30 }, () => http('POST', '/__gate/login', form('wrong-password', ip))));
    const wrong = results.filter((r) => r.status === 401).length;
    const limited = results.filter((r) => r.status === 429).length;
    assert.ok(wrong <= 10, `${wrong} attempts were verified`);
    assert.equal(wrong + limited, 30);
    assert.ok(results.every((r) => !r.headers['set-cookie']));
  });
});

describe('preview gate: slow logins (review r2 P3)', () => {
  it('trickled login bodies do not hold the verification slots', async () => {
    // Open 8 logins from 4 IPs that send headers and never finish their bodies.
    const { connect } = await import('node:net');
    const socks = [];
    for (let i = 0; i < 8; i += 1) {
      const s = connect(gatePort, '127.0.0.1');
      s.on('error', () => {});
      s.write(`POST /__gate/login HTTP/1.1\r\nhost: ${HOST}\r\ncf-connecting-ip: 198.18.0.${i % 4}\r\ncontent-type: application/x-www-form-urlencoded\r\ncontent-length: 100\r\n\r\npassword=`);
      socks.push(s);
    }
    await new Promise((r) => setTimeout(r, 100));
    const r = await http('POST', '/__gate/login', form(PASSWORD, { 'cf-connecting-ip': '192.0.2.200' }));
    for (const s of socks) s.destroy();
    assert.equal(r.status, 303, 'a real viewer can still log in');
  });
});

describe('preview gate: login timeout is per request (review r3 P3)', () => {
  it('a slow proxied call on the same keep-alive connection after a login is not cut off', async () => {
    const slow = createServer((req, res) => setTimeout(() => res.end('{"ok":true}'), 400));
    const slowPort = await listen(slow);
    const g = createGateServer({ root, apiOrigin: `http://127.0.0.1:${slowPort}`, allowedHosts: [HOST], secret: { ...hashPassword(PASSWORD), cookieKey: randomBytes(32).toString('base64') }, loginTimeoutMs: 150 });
    const port = await listen(g);
    const { Agent } = await import('node:http');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const viaAgent = (method, path, headers, body) =>
      new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, method, path, agent, headers: { host: HOST, ...headers } }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, socket: req.socket }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    const login = await viaAgent('POST', '/__gate/login', { 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ password: PASSWORD }).toString());
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const r = await viaAgent('GET', '/api/slow', { cookie });
    agent.destroy();
    g.close();
    slow.close();
    assert.equal(r.status, 200);
    assert.equal(r.socket, login.socket, 'same keep-alive socket');
  });
});

describe('preview gate: login body deadline is total, not idle (review r3 P3)', () => {
  it('a body trickled faster than the timeout is still cut off at the deadline', async () => {
    const g = createGateServer({ root, apiOrigin: 'http://127.0.0.1:9', allowedHosts: [HOST], secret: { ...hashPassword(PASSWORD), cookieKey: randomBytes(32).toString('base64') }, loginTimeoutMs: 300 });
    const port = await listen(g);
    const { connect } = await import('node:net');
    const sock = connect(port, '127.0.0.1');
    sock.on('error', () => {});
    sock.write(`POST /__gate/login HTTP/1.1\r\nhost: ${HOST}\r\ncontent-type: application/x-www-form-urlencoded\r\ncontent-length: 200\r\n\r\np`);
    const started = Date.now();
    const timer = setInterval(() => sock.write('x'), 80);
    const closedAt = await new Promise((resolve) => {
      sock.on('close', () => resolve(Date.now()));
      setTimeout(() => resolve(null), 2000);
    });
    clearInterval(timer);
    sock.destroy();
    g.close();
    assert.ok(closedAt !== null && closedAt - started < 1500, 'trickled login body was not cut off');
  });
});

describe('preview gate: shared-demo convenience (Hamza, 2026-10-03)', () => {
  const demoAccounts = [
    { role: 'tester', email: 'demo-tester@pocketqa.example', password: randomBytes(18).toString('base64url') },
    { role: 'builder', email: 'demo-builder@pocketqa.example', password: randomBytes(18).toString('base64url') },
    { role: 'admin', email: 'demo-admin@pocketqa.example', password: randomBytes(18).toString('base64url') },
  ];
  const open = [];
  after(() => open.forEach((g) => g.close()));
  async function convGate(convenience) {
    const g = createGateServer({ root, apiOrigin: `http://127.0.0.1:${upstreamPort}`, allowedHosts: [HOST], secret: { ...hashPassword(PASSWORD), cookieKey: randomBytes(32).toString('base64') }, convenience });
    open.push(g); // closed in after() even when an assertion fails
    return { g, port: await listen(g) };
  }

  it('prefills the gate password (HTML-escaped) and says it is not access protection', async () => {
    const { g, port } = await convGate({ gatePrefill: PASSWORD, demoAccounts });
    const page = await http('GET', '/__gate/login', { port });
    assert.ok(page.body.includes(`value="${PASSWORD}"`));
    assert.match(page.body, /not access protection/);
    // Review r1 P2: no privacy claim anywhere while the convenience is on, error pages included.
    assert.ok(!/Private/i.test(page.body));
    const wrong = await http('POST', '/__gate/login', { ...form('wrong-password'), port });
    assert.equal(wrong.status, 401);
    assert.ok(!/Private/i.test(wrong.body) && wrong.body.includes(`value="${PASSWORD}"`) && /Public demo preview/.test(wrong.body));
    const hostile = await convGate({ gatePrefill: 'a"><script>alert(1)</script>' });
    const p2 = await http('GET', '/__gate/login', { port: hostile.port });
    assert.ok(!p2.body.includes('<script>alert(1)'));
    assert.ok(p2.body.includes('value="a&quot;&gt;&lt;script&gt;'));
    hostile.g.close();
    g.close();
  });

  it('serves demo sign-ins only behind the gate, GET only', async () => {
    const { g, port } = await convGate({ gatePrefill: PASSWORD, demoAccounts });
    const anon = await http('GET', '/__preview/bootstrap.json', { port });
    assert.notEqual(anon.status, 200);
    for (const a of demoAccounts) assert.ok(!anon.body.includes(a.password));
    const login = await http('POST', '/__gate/login', { ...form(PASSWORD), port });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const ok = await http('GET', '/__preview/bootstrap.json', { headers: { cookie }, port });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(ok.body).demoAccounts.map((a) => a.role), ['tester', 'builder', 'admin']);
    assert.equal((await http('POST', '/__preview/bootstrap.json', { headers: { cookie }, port })).status, 405);
    g.close();
  });

  it('is off by default: no prefill, no bootstrap', async () => {
    const page = await http('GET', '/__gate/login');
    assert.ok(!/ value="/.test(page.body));
    const cookie = await signIn();
    assert.equal((await http('GET', '/__preview/bootstrap.json', { headers: { cookie } })).status, 404);
  });

  it('the convenience file must be 0600 and list only the synthetic demo accounts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-conv-'));
    const f = join(dir, 'convenience.json');
    writeFileSync(f, JSON.stringify({ gatePrefill: 'x', demoAccounts }));
    chmodSync(f, 0o644);
    assert.throws(() => loadConvenience(f), /0600/);
    chmodSync(f, 0o600);
    assert.equal(loadConvenience(f).demoAccounts.length, 3);
    writeFileSync(f, JSON.stringify({ demoAccounts: [{ role: 'admin', email: 'someone@real.example', password: 'x'.repeat(20) }] }));
    assert.throws(() => loadConvenience(f), /synthetic/);
  });
});

describe('preview gate: configuration guards', () => {
  it('refuses a non-loopback API origin and a short cookie key', () => {
    const secret = { ...hashPassword('x'), cookieKey: randomBytes(32).toString('base64') };
    assert.throws(() => createGateServer({ root: '.', apiOrigin: 'http://10.0.0.5:8787', allowedHosts: [HOST], secret }), /loopback/);
    assert.throws(() => createGateServer({ root: '.', apiOrigin: 'http://127.0.0.1:1', allowedHosts: [HOST], secret: { ...secret, cookieKey: randomBytes(8).toString('base64') } }), /32 bytes/);
  });

  it('refuses a secret file readable by other users', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-gate-secret-'));
    const f = join(dir, 'secret.json');
    writeFileSync(f, JSON.stringify({ ...hashPassword('x'), cookieKey: randomBytes(32).toString('base64') }));
    chmodSync(f, 0o644);
    assert.throws(() => loadSecret(f), /0600/);
    chmodSync(f, 0o600);
    assert.ok(loadSecret(f).cookieKey);
  });

  it('session tokens verify only with the right key and before expiry', () => {
    const k = randomBytes(32);
    const v = signSession(k, 1_000_000);
    assert.ok(verifySession(k, v, 1_000_000));
    assert.ok(!verifySession(randomBytes(32), v, 1_000_000));
    assert.ok(!verifySession(k, v, 1_000_000 + 13 * 3600 * 1000));
    assert.ok(!verifySession(k, 'v1.1.2', 0));
  });
});
