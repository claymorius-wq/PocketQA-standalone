// Production web front door (docs/production/web-launch.md). One loopback listener behind the
// TLS tunnel, like the preview gate (ADR 0004) but with no gate, no demo bootstrap and no
// preview block list:
// - the production `expo export` web build (scripts/production/build-web.sh), with SPA fallback;
// - a same-origin proxy `/api/*` → the loopback Pocket QA API, so the API stays bound to 127.0.0.1;
// - security headers on everything, and an app CSP whose connect-src names exactly what the
//   browser must reach besides this origin: Firebase Auth's two endpoints and the one R2 bucket
//   for presigned direct uploads. Playback goes through /api, so media stays 'self'.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { API_CSP, appCsp, connectOrigins, securityHeaders } from './security-headers.mjs';

export { appCsp, connectOrigins, FIREBASE_AUTH_ORIGINS } from './security-headers.mjs';

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

// Hop-by-hop headers (RFC 9110 §7.6.1), plus any named in `Connection`, never cross the proxy.
// Cookies don't either: the app authenticates with a bearer token and sets no cookies.
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie']);
// Client-supplied forwarding headers are never passed on; the front door states the client
// address itself (see clientAddress), so the API's per-client rate limits can't be steered.
const FORWARDING = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

/**
 * The client's address for the API's X-Forwarded-For. Behind the tunnel every connection comes
 * from loopback, and cloudflared reports the visitor in CF-Connecting-IP (Cloudflare's edge sets
 * it; clients can't). Anything else is the socket peer itself.
 */
function clientAddress(req) {
  const peer = req.socket.remoteAddress ?? '';
  const cf = String(req.headers['cf-connecting-ip'] ?? '').trim();
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  return loopback && isIP(cf) ? cf : peer;
}
function stripSet(headers) {
  const named = String(headers.connection ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...HOP, ...named]);
}

/**
 * @param {{ root: string, apiOrigin: string, allowedHosts: string[], connect: string[], log?: (line: string) => void }} opts
 */
export function createWebServer(opts) {
  const root = normalize(opts.root);
  if (!existsSync(join(root, 'index.html'))) throw new Error('web root has no index.html (run scripts/production/build-web.sh)');
  const api = new URL(opts.apiOrigin);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(api.hostname)) throw new Error('apiOrigin must be a loopback address');
  const hosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const csp = appCsp(opts.connect);
  const log = opts.log ?? (() => {});
  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { ...securityHeaders(), 'cache-control': 'no-store', ...extra });
    res.end(body);
  };
  const apiError = (res, status, code, message, extra = {}) => send(res, status, JSON.stringify({ code, message }), { 'content-type': 'application/json', 'content-security-policy': API_CSP, ...extra });

  function proxy(req, res) {
    const rest = req.url.slice('/api'.length);
    const path = rest.startsWith('/') ? rest : `/${rest}`;
    const q = path.indexOf('?');
    const rawPath = q >= 0 ? path.slice(0, q) : path;
    // One canonical spelling per route (API ids and tokens never need these).
    if (/[%;\\]|\/\/|\/\.\.?(\/|$)/.test(rawPath)) {
      req.resume();
      return apiError(res, 400, 'VALIDATION', 'Malformed API path.', { connection: 'close' });
    }
    const strip = stripSet(req.headers);
    const fwd = {};
    for (const [k, v] of Object.entries(req.headers)) if (!strip.has(k)) fwd[k] = v;
    for (const k of FORWARDING) delete fwd[k];
    fwd['x-forwarded-for'] = clientAddress(req);
    fwd.host = api.host;
    const up = httpRequest({ hostname: api.hostname.replace(/^\[|\]$/g, ''), port: api.port, method: req.method, path, headers: fwd, timeout: 120_000 }, (r) => {
      const drop = stripSet(r.headers);
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!drop.has(k) && k !== 'set-cookie') out[k] = v;
      res.writeHead(r.statusCode ?? 502, { ...out, ...securityHeaders(), 'content-security-policy': API_CSP });
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('upstream timeout')));
    up.on('error', () => {
      log('api unreachable');
      if (!res.headersSent) apiError(res, 502, 'INTERNAL', 'Pocket QA is not reachable right now.');
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
    res.writeHead(200, {
      ...securityHeaders(),
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      // index.html is never cached, so a rollback takes effect on the next load.
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
      'content-security-policy': csp,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  return createServer((req, res) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return send(res, 421, 'Misdirected request', { 'content-type': 'text/plain' });
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/api' || path.startsWith('/api/')) return proxy(req, res);
    return serveStatic(req, res);
  });
}

if (import.meta.main) {
  const env = process.env;
  const port = Number(env.WEB_PORT);
  const apiPort = Number(env.WEB_API_PORT);
  const publicHost = env.WEB_PUBLIC_HOST;
  if (!port || !apiPort || !publicHost || !env.WEB_ROOT || !env.WEB_R2_ACCOUNT_ID || !env.WEB_R2_BUCKET) {
    console.error('Set WEB_PORT, WEB_API_PORT, WEB_PUBLIC_HOST, WEB_ROOT, WEB_R2_ACCOUNT_ID and WEB_R2_BUCKET.');
    process.exit(2);
  }
  const server = createWebServer({
    root: env.WEB_ROOT,
    apiOrigin: `http://127.0.0.1:${apiPort}`,
    allowedHosts: [publicHost, `127.0.0.1:${port}`, `localhost:${port}`],
    connect: connectOrigins(env.WEB_R2_ACCOUNT_ID, env.WEB_R2_BUCKET),
    log: (line) => console.log(new Date().toISOString(), line),
  });
  server.listen(port, '127.0.0.1', () => console.log(`pocketqa web on 127.0.0.1:${port} for ${publicHost} (api 127.0.0.1:${apiPort})`));
}
