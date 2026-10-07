// Serves a built `.vercel/output` (scripts/vercel/build.mjs) on loopback exactly as its config.json
// routes it, so the real web app can be rehearsed under the hosted headers before any deploy:
//   - route headers in order (the app CSP for documents, the sandbox CSP for /api);
//   - `dest: '/api'` → the api.func default export, with the original URL (as Vercel passes it);
//   - `handle: 'filesystem'` → a static file if one exists; then the SPA fallback.
// config.json is only ever read. A route shape this server doesn't implement is refused, so a
// passing rehearsal can't silently skip part of the real routing.
//
// Test-only: `--test-connect <origin>` appends ONE extra connect-src source in memory (e.g. the
// Firebase Auth emulator). Only a loopback http origin is accepted; a real deployment never has it.
//   node scripts/vercel/serve-local.mjs --port 8495 [--dir .vercel/output] [--test-connect http://127.0.0.1:9399]
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

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
/** The live USB/local API's port: never taken by a rehearsal. */
const RESERVED_PORTS = new Set([8787]);
const ROUTE_KEYS = new Set(['src', 'headers', 'continue', 'dest']);

/** A loopback http origin, exactly (no path, query or credentials), or throws. */
export function parseTestConnect(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`--test-connect must be a loopback http origin, got ${JSON.stringify(value)}`);
  }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  if (u.protocol !== 'http:' || !loopback || u.origin !== value || u.username || u.password) {
    throw new Error(`--test-connect must be a loopback http origin such as http://127.0.0.1:9399, got ${JSON.stringify(value)}`);
  }
  return u.origin;
}

/** Validates the routes this server implements; anything else is refused. */
export function checkRoutes(config) {
  if (config?.version !== 3 || !Array.isArray(config.routes)) throw new Error('config.json is not Build Output API v3');
  for (const [i, r] of config.routes.entries()) {
    if ('handle' in r) {
      if (r.handle !== 'filesystem' || Object.keys(r).length !== 1) throw new Error(`route ${i}: only { handle: 'filesystem' } is implemented`);
      continue;
    }
    for (const k of Object.keys(r)) if (!ROUTE_KEYS.has(k)) throw new Error(`route ${i}: "${k}" is not implemented by serve-local`);
    if (typeof r.src !== 'string') throw new Error(`route ${i}: src is required`);
  }
  return config;
}

/** A copy of the config whose CSP connect-src also allows `origin` (test-only; nothing on disk changes). */
export function withTestConnect(config, origin) {
  const o = parseTestConnect(origin);
  const routes = config.routes.map((r) => {
    const csp = r.headers?.['content-security-policy'];
    if (!csp || !/(^|;\s*)connect-src /.test(csp)) return r;
    return { ...r, headers: { ...r.headers, 'content-security-policy': csp.replace(/((?:^|;\s*)connect-src [^;]*)/, `$1 ${o}`) } };
  });
  return { ...config, routes };
}

/**
 * Vercel's route pass for one request path: headers merge in order; a matching `dest` without
 * `continue` ends the pass. Returns the headers and the target.
 *   { kind: 'function' } | { kind: 'static', file } | { kind: 'notfound' }
 */
export function resolveRoute(config, pathname, hasFile) {
  const headers = {};
  let path = pathname;
  for (const r of config.routes) {
    if (r.handle === 'filesystem') {
      if (hasFile(path)) return { headers, target: { kind: 'static', file: path } };
      continue;
    }
    // Vercel matches `src` against the whole path.
    if (!new RegExp(`^(?:${r.src})$`).test(path)) continue;
    Object.assign(headers, r.headers ?? {});
    if (r.dest !== undefined) {
      if (r.dest === '/api') return { headers, target: { kind: 'function' } };
      path = r.dest;
      if (!r.continue) return { headers, target: hasFile(path) ? { kind: 'static', file: path } : { kind: 'notfound' } };
    }
  }
  return { headers, target: hasFile(path) ? { kind: 'static', file: path } : { kind: 'notfound' } };
}

/** Static lookup confined to the output's static directory. */
function staticFiles(root) {
  const full = (p) => {
    const f = join(root, normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, ''));
    return f === root || f.startsWith(root + sep) ? f : null;
  };
  return {
    has(p) {
      const f = full(p);
      return !!f && existsSync(f) && statSync(f).isFile();
    },
    path: full,
  };
}

export async function serveLocal({ dir, port, testConnect }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || RESERVED_PORTS.has(port)) throw new Error(`--port must be a free unprivileged port other than ${[...RESERVED_PORTS].join(', ')}`);
  const out = resolve(dir);
  let config = checkRoutes(JSON.parse(readFileSync(join(out, 'config.json'), 'utf8')));
  if (testConnect) config = withTestConnect(config, testConnect);
  const files = staticFiles(join(out, 'static'));
  const fn = (await import(pathToFileURL(join(out, 'functions/api.func/index.mjs')).href)).default;
  if (typeof fn !== 'function') throw new Error('api.func has no default export');

  const server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const { headers, target } = resolveRoute(config, pathname, files.has);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (target.kind === 'function') {
      Promise.resolve(fn(req, res)).catch((e) => {
        console.error('api.func failed', e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"code":"INTERNAL"}');
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end();
    }
    if (target.kind === 'notfound') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const file = files.path(target.file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', ok));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  try {
    const port = Number(opt('--port'));
    const testConnect = opt('--test-connect');
    const dir = opt('--dir') ?? join(import.meta.dirname, '../../.vercel/output');
    await serveLocal({ dir, port, testConnect });
    console.log(`serving ${dir} on http://127.0.0.1:${port}${testConnect ? ` (test connect-src + ${testConnect})` : ''}`);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
