// Protected web preview server (authorized exposure, 2026-10-03; see docs/preview.md).
//
// One loopback listener in front of everything the browser can fetch:
// - a password gate: every HTML page, asset and API call needs a valid gate cookie, except
//   the login page itself and its POST;
// - the static `expo export --platform web` build, with SPA fallback;
// - a same-origin proxy `/api/*` → the loopback Pocket QA API, so the browser never calls
//   localhost and the API stays bound to 127.0.0.1.
//
// The gate uses its own HttpOnly cookie, never HTTP Basic, so it can't collide with the
// app's `Authorization: Bearer` session token, which passes through the proxy untouched.
// The gate cookie is stripped before proxying so it never reaches the API or its logs.
import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

export const COOKIE = '__Host-pqa_gate';
const SESSION_TTL_S = 12 * 3600;
const LOGIN_BODY_MAX = 2048;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_PER_IP = 10;
// Global cap far above the per-IP one: it only stops a wide spray of guesses. Hitting it
// blocks new gate logins (not existing sessions) until the window passes (ADR 0004).
const FAIL_GLOBAL = 1000;
// scrypt is costly, so at most this many logins are verified at once (per IP / overall);
// extra concurrent attempts get 429 instead of queueing work.
const INFLIGHT_PER_IP = 2;
const INFLIGHT_GLOBAL = 8;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

// Hop-by-hop headers (RFC 9110 §7.6.1), plus any header named in `Connection`, never cross
// the proxy; neither do the gate cookie and the inbound Host.
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie']);
function stripSet(headers) {
  const named = String(headers.connection ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...HOP, ...named]);
}

/**
 * API calls the shared preview refuses (ADR 0004): every viewer shares the demo accounts,
 * so nothing that publishes a viewer's own files or breaks the demo for others is allowed.
 */
export const PREVIEW_BLOCKED_API = [
  { method: 'POST', path: /^\/participations\/[^/]+\/evidence$/, message: 'Uploads are turned off in the shared preview, because other viewers could see them. Recording and evidence upload work in the Android app.' },
  { method: 'DELETE', path: /^\/me$/, message: 'Deleting the shared demo account is turned off in the preview.' },
  { method: 'POST', path: /^\/auth\/register$/, message: 'Creating accounts is turned off in the shared preview. Use one of the demo accounts.' },
  { method: 'POST', path: /^\/admin\/moderation\/(users|studies)\/[^/]+$/, message: 'Suspending demo accounts or studies is turned off in the shared preview.' },
];

/** Hashes a gate password for the secret file (the plaintext is never stored there). */
export function hashPassword(password, salt = randomBytes(16)) {
  return { salt: salt.toString('base64'), hash: scryptSync(password, salt, 32, SCRYPT).toString('base64') };
}

/** Async (off the event loop), so a login burst can't stall other viewers. */
export function verifyPassword(password, { salt, hash }) {
  return new Promise((resolve) => {
    scrypt(String(password), Buffer.from(salt, 'base64'), 32, SCRYPT, (err, got) => {
      const want = Buffer.from(hash, 'base64');
      resolve(!err && got.length === want.length && timingSafeEqual(got, want));
    });
  });
}

/** Cookie value: `v1.<expiry s>.<nonce>.<hmac>`, HMAC-SHA256 over the first three parts. */
export function signSession(key, nowMs, ttlS = SESSION_TTL_S) {
  const body = `v1.${Math.floor(nowMs / 1000) + ttlS}.${randomBytes(12).toString('base64url')}`;
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

export function verifySession(key, value, nowMs, revoked) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const body = parts.slice(0, 3).join('.');
  const want = Buffer.from(createHmac('sha256', key).update(body).digest('base64url'));
  const got = Buffer.from(parts[3]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  const exp = Number(parts[1]);
  if (revoked?.has(parts[2])) return false;
  return Number.isInteger(exp) && exp * 1000 > nowMs;
}

function cookieValue(header, name) {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function securityHeaders(secure) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    ...(secure ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}

// The app is a React Native Web bundle: inline styles are required, inline scripts aren't.
// API responses (JSON and uploaded media) are never documents to render.
const API_CSP = "default-src 'none'; sandbox";
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const LOGIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loginPage(error, prefill) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="pocketqa-preview" content="gate"><meta name="robots" content="noindex"><title>Pocket QA preview</title>
<style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:Canvas;color:CanvasText}
main{width:min(360px,calc(100% - 32px))}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px;opacity:.75;font-size:14px}
input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid #8888}button{margin-top:12px;background:#3540c4;color:#fff;border:0;font-weight:600}
.err{color:#c0392b;margin-top:12px;font-size:14px}</style></head>
<body><main><h1>Pocket QA preview</h1>
${prefill
  ? '<p><strong>Public demo preview.</strong> The password is filled in for you, so this page is not access protection: treat everything here as public. Synthetic data only. Devnet and test credits only. No real payments.</p>'
  : '<p>Private preview. Devnet and test credits only. No real payments.</p>'}
<p>Demo accounts are shared with other viewers: don't type personal information. Uploads are turned off.</p>
<form method="post" action="/__gate/login"><label for="pw">Preview password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required${prefill ? ` value="${escapeHtml(prefill)}"` : ' autofocus'}>
<button type="submit"${prefill ? ' autofocus' : ''}>Enter preview</button></form>${error ? `<div class="err" role="alert">${error}</div>` : ''}</main></body></html>`;
}

/**
 * @param {{ root: string, apiOrigin: string, allowedHosts: string[], secret: { salt: string, hash: string, cookieKey: string },
 *           secureCookie?: boolean, now?: () => number, log?: (line: string) => void,
 *           blockedApi?: { method: string, path: RegExp, message: string }[], loginTimeoutMs?: number,
 *           convenience?: { gatePrefill?: string, demoAccounts?: { role: string, email: string, password: string }[] } }} opts
 */
export function createGateServer(opts) {
  const root = normalize(opts.root);
  const api = new URL(opts.apiOrigin);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(api.hostname)) throw new Error('apiOrigin must be a loopback address');
  const key = Buffer.from(opts.secret.cookieKey, 'base64');
  if (key.length < 32) throw new Error('cookieKey must be at least 32 bytes');
  const hosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const secure = opts.secureCookie ?? true;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const blocked = opts.blockedApi ?? PREVIEW_BLOCKED_API;
  const loginTimeoutMs = opts.loginTimeoutMs ?? 10_000;
  const convenience = opts.convenience ?? null;
  const fails = new Map(); // ip -> [timestamps]
  let globalFails = [];
  const inflight = new Map(); // ip -> count of logins being verified
  let inflightAll = 0;
  const revoked = new Map(); // nonce -> expiry (s) of logged-out sessions
  // Housekeeping so the maps can't grow without bound.
  const sweep = setInterval(() => {
    const t = now();
    for (const [ip, list] of fails) {
      const keep = list.filter((x) => t - x < FAIL_WINDOW_MS);
      if (keep.length) fails.set(ip, keep);
      else fails.delete(ip);
    }
    for (const [nonce, exp] of revoked) if (exp * 1000 <= t) revoked.delete(nonce);
  }, 60_000);
  sweep.unref();

  const headers = (extra = {}) => ({ ...securityHeaders(secure), ...extra });
  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, headers({ 'cache-control': 'no-store', ...extra }));
    res.end(body);
  };

  // Behind the tunnel every connection comes from loopback, so the client IP is the one
  // cloudflared reports. The listener is loopback-only, so the header can't be forged from outside.
  const clientIp = (req) => String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown');

  function limited(ip) {
    const t = now();
    globalFails = globalFails.filter((x) => t - x < FAIL_WINDOW_MS);
    const mine = (fails.get(ip) ?? []).filter((x) => t - x < FAIL_WINDOW_MS);
    if (mine.length) fails.set(ip, mine);
    else fails.delete(ip);
    return mine.length >= FAIL_PER_IP || globalFails.length >= FAIL_GLOBAL;
  }
  function recordFail(ip) {
    const t = now();
    fails.set(ip, [...(fails.get(ip) ?? []), t]);
    globalFails.push(t);
  }

  function login(req, res) {
    const ip = clientIp(req);
    // CSRF: browsers send Origin on POST; it must be this site. (SameSite=Strict covers the rest.)
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let ok;
      try {
        ok = hosts.has(new URL(origin).host.toLowerCase());
      } catch {
        ok = false;
      }
      if (!ok) return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' });
    }
    const tooMany = () => {
      log('gate login rate-limited');
      send(res, 429, loginPage('Too many attempts. Try again in 15 minutes.', convenience?.gatePrefill), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': LOGIN_CSP, 'retry-after': '900' });
    };
    if (limited(ip)) return tooMany();
    // A login body is tiny: it gets a total deadline (not an idle timeout, which a trickle
    // would keep resetting). The timer is per request and cleared once the body is in, so
    // it never outlives this login on a reused (cloudflared keep-alive) connection.
    const deadline = setTimeout(() => req.destroy(), loginTimeoutMs);
    req.on('end', () => clearTimeout(deadline));
    res.on('close', () => clearTimeout(deadline));
    let released = true;
    const release = () => {
      if (released) return;
      released = true;
      inflightAll -= 1;
      const n = (inflight.get(ip) ?? 1) - 1;
      if (n > 0) inflight.set(ip, n);
      else inflight.delete(ip);
    };
    res.on('close', release);
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > LOGIN_BODY_MAX) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (size > LOGIN_BODY_MAX) return;
      // Re-check: failures recorded while this body was arriving count too. The scrypt slot
      // is taken only now, so slow senders can't hold it.
      if (limited(ip) || (inflight.get(ip) ?? 0) >= INFLIGHT_PER_IP || inflightAll >= INFLIGHT_GLOBAL) return tooMany();
      inflight.set(ip, (inflight.get(ip) ?? 0) + 1);
      inflightAll += 1;
      released = false;
      const password = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password') ?? '';
      const ok = password ? await verifyPassword(password, opts.secret) : false;
      release();
      if (!ok) {
        recordFail(ip);
        log('gate login failed');
        return send(res, 401, loginPage('Wrong password.', convenience?.gatePrefill), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': LOGIN_CSP });
      }
      log('gate login ok');
      const cookie = `${COOKIE}=${signSession(key, now())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_S}${secure ? '; Secure' : ''}`;
      res.writeHead(303, headers({ location: '/', 'set-cookie': cookie, 'cache-control': 'no-store' }));
      res.end();
    });
  }

  const apiError = (res, status, code, message) => send(res, status, JSON.stringify({ code, message }), { 'content-type': 'application/json', 'content-security-policy': API_CSP });

  function proxy(req, res) {
    const rest = req.url.slice('/api'.length);
    const raw = rest.startsWith('/') ? rest : `/${rest}`;
    const q = raw.indexOf('?');
    const rawPath = q >= 0 ? raw.slice(0, q) : raw;
    // One canonical spelling per route, so the preview block list can't be sidestepped with
    // percent-encoding, `;` parameters, backslashes, dot segments or doubled slashes (API ids
    // and tokens never need them).
    if (/[%;\\]|\/\/|\/\.\.?(\/|$)/.test(rawPath)) {
      req.resume();
      return send(res, 400, JSON.stringify({ code: 'VALIDATION', message: 'Malformed API path.' }), { 'content-type': 'application/json', 'content-security-policy': API_CSP, connection: 'close' });
    }
    const path = raw;
    const rule = blocked.find((b) => b.method === req.method && b.path.test(rawPath.replace(/\/$/, '')));
    if (rule) {
      // Refuse without reading a possibly large upload, and close the connection so the
      // client doesn't reuse a socket whose request body was never consumed.
      req.resume();
      return send(res, 403, JSON.stringify({ code: 'FORBIDDEN_ROLE', message: rule.message }), { 'content-type': 'application/json', 'content-security-policy': API_CSP, connection: 'close' });
    }
    const strip = stripSet(req.headers);
    const fwd = {};
    for (const [k, v] of Object.entries(req.headers)) if (!strip.has(k)) fwd[k] = v;
    fwd.host = api.host;
    const up = httpRequest({ hostname: api.hostname.replace(/^\[|\]$/g, ''), port: api.port, method: req.method, path, headers: fwd, timeout: 120_000 }, (r) => {
      const drop = stripSet(r.headers);
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!drop.has(k) && k !== 'set-cookie') out[k] = v;
      res.writeHead(r.statusCode ?? 502, { ...out, ...securityHeaders(secure), 'content-security-policy': API_CSP });
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('upstream timeout')));
    up.on('error', () => {
      if (!res.headersSent) apiError(res, 502, 'INTERNAL', 'The preview API is not reachable.');
      else res.destroy();
    });
    req.pipe(up);
  }

  function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'content-type': 'text/plain', allow: 'GET, HEAD' });
    let rel;
    try {
      rel = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return send(res, 400, 'Bad request', { 'content-type': 'text/plain' });
    }
    if (rel.includes('\0')) return send(res, 400, 'Bad request', { 'content-type': 'text/plain' });
    let file = normalize(join(root, rel));
    if (!(file === root || file.startsWith(root + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    const ext = extname(file);
    res.writeHead(200, headers({
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'private, max-age=300',
      'content-security-policy': APP_CSP,
    }));
    if (req.method === 'HEAD') return res.end();
    // A file can vanish mid-request (e.g. during a rebuild); end this response, not the process.
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  return createServer((req, res) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return send(res, 421, 'Misdirected request', { 'content-type': 'text/plain' });
    const url = req.url ?? '/';
    const path = url.split('?')[0];

    if (path === '/__gate/login') {
      if (req.method === 'GET') return send(res, 200, loginPage(undefined, convenience?.gatePrefill), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': LOGIN_CSP });
      if (req.method === 'POST') return login(req, res);
      return send(res, 405, 'Method not allowed', { 'content-type': 'text/plain', allow: 'GET, POST' });
    }

    const session = cookieValue(req.headers.cookie, COOKIE);
    if (!verifySession(key, session, now(), revoked)) {
      // `gate: true` marks the gate's answer; the code is one the app's error parser knows.
      if (path === '/api' || path.startsWith('/api/')) return send(res, 401, JSON.stringify({ code: 'UNAUTHENTICATED', gate: true, message: 'Preview access expired. Reload the page to enter the preview password again.' }), { 'content-type': 'application/json', 'content-security-policy': API_CSP });
      if (req.method === 'GET' || req.method === 'HEAD') return send(res, 303, '', { location: '/__gate/login' });
      return send(res, 401, 'Preview access required', { 'content-type': 'text/plain' });
    }

    if (path === '/__gate/logout' && req.method === 'POST') {
      // Server-side revocation, so a copied cookie stops working too.
      const [, exp, nonce] = session.split('.');
      revoked.set(nonce, Number(exp));
      return send(res, 303, '', { location: '/__gate/login', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}` });
    }
    // Demo sign-ins for the shared preview, only behind the gate (never in a bundle).
    if (path === '/__preview/bootstrap.json') {
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed', { 'content-type': 'text/plain', allow: 'GET' });
      if (!convenience?.demoAccounts?.length) return send(res, 404, JSON.stringify({ code: 'NOT_FOUND', message: 'No demo bootstrap.' }), { 'content-type': 'application/json', 'content-security-policy': API_CSP });
      return send(res, 200, JSON.stringify({ demoAccounts: convenience.demoAccounts }), { 'content-type': 'application/json', 'content-security-policy': API_CSP });
    }
    if (path === '/api' || path.startsWith('/api/')) return proxy(req, res);
    return serveStatic(req, res);
  });
}

const SYNTHETIC_DEMO = /^demo-(tester|builder|admin)@pocketqa\.example$/;

/**
 * Optional shared-demo convenience file (0600, git-ignored): the gate prefill and the
 * synthetic demo sign-ins. Anything that isn't a seeded synthetic account is refused.
 */
export function loadConvenience(path) {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`convenience file must be mode 0600 (is ${mode.toString(8)})`);
  const c = JSON.parse(readFileSync(path, 'utf8'));
  for (const a of c.demoAccounts ?? []) {
    if (!['tester', 'builder', 'admin'].includes(a.role) || a.email !== `demo-${a.role}@pocketqa.example` || !SYNTHETIC_DEMO.test(a.email)) {
      throw new Error('convenience file may only list the seeded synthetic demo accounts');
    }
  }
  return { gatePrefill: c.gatePrefill || undefined, demoAccounts: (c.demoAccounts ?? []).map(({ role, email, password }) => ({ role, email, password })) };
}

/** Reads the gate secret file and refuses one that other users could read. */
export function loadSecret(path) {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`gate secret file must be mode 0600 (is ${mode.toString(8)})`);
  const s = JSON.parse(readFileSync(path, 'utf8'));
  if (!s.salt || !s.hash || !s.cookieKey) throw new Error('gate secret file is incomplete');
  return s;
}

if (import.meta.main) {
  const env = process.env;
  const port = Number(env.PREVIEW_PORT);
  const apiPort = Number(env.PREVIEW_API_PORT);
  const publicHost = env.PREVIEW_PUBLIC_HOST;
  if (!port || !apiPort || !publicHost || !env.PREVIEW_SECRET_FILE || !env.PREVIEW_WEB_ROOT) {
    console.error('Set PREVIEW_PORT, PREVIEW_API_PORT, PREVIEW_PUBLIC_HOST, PREVIEW_SECRET_FILE and PREVIEW_WEB_ROOT.');
    process.exit(2);
  }
  const secret = loadSecret(env.PREVIEW_SECRET_FILE);
  const convenience = env.PREVIEW_CONVENIENCE_FILE && existsSync(env.PREVIEW_CONVENIENCE_FILE) ? loadConvenience(env.PREVIEW_CONVENIENCE_FILE) : null;
  // The prefill must be the real gate password; refuse to start if they drifted apart.
  if (convenience?.gatePrefill && !(await verifyPassword(convenience.gatePrefill, secret))) {
    console.error('PREVIEW_CONVENIENCE_FILE gatePrefill does not match the gate secret; refusing to start.');
    process.exit(2);
  }
  const server = createGateServer({
    root: env.PREVIEW_WEB_ROOT,
    apiOrigin: `http://127.0.0.1:${apiPort}`,
    allowedHosts: [publicHost, `127.0.0.1:${port}`, `localhost:${port}`],
    secret,
    convenience,
    log: (line) => console.log(new Date().toISOString(), line),
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`pocketqa preview gate on 127.0.0.1:${port} for ${publicHost} (api 127.0.0.1:${apiPort})${convenience ? ' [shared-demo convenience on]' : ''}`),
  );
}
