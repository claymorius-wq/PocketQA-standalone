import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Page } from '@playwright/test';
import { base64 } from '@scure/base';
import { routeDevnetRpc, type FakeAccount } from './fakeDevnetRpc';

// Test side of the LOCAL hosted-devnet run (the backend is local-devnet-server.mts, its own process).
// The browser sees ONE virtual https origin served by Playwright routing: static files from the
// web export, `/api/*` forwarded to the local backend. Firebase Auth calls go to the Auth emulator,
// the client's pinned devnet RPC to the fake chain, and every other request is aborted (fail
// closed): no real Firebase project, no real chain, no DNS. Not evidence of a real devnet transfer.
export const ORIGIN = 'https://pocketqa-devnet.example';
export const ORIGIN_HOST = 'pocketqa-devnet.example';
export const CRON = 'c'.repeat(40);
export const BACKEND = `http://127.0.0.1:${process.env.PQA_DEVNET_API_PORT ?? 8693}`;

/** The backend's API (no /api prefix) as a party with an ID token. */
export async function call(method: string, path: string, token?: string, payload?: unknown) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
/** The test wallet's `send`: the fake chain verifies the signature and applies the transaction. */
export async function walletSend(signed: Uint8Array): Promise<string> {
  const r = await fetch(`${BACKEND}/__harness/wallet-send`, { method: 'POST', body: base64.encode(signed) });
  const j = (await r.json()) as { signature?: string; message?: string };
  if (!r.ok || !j.signature) throw new Error(j.message ?? `wallet send failed (${r.status})`);
  return j.signature;
}
export async function landed(): Promise<string[]> {
  return (await (await fetch(`${BACKEND}/__harness/landed`)).json()) as string[];
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

/** Routes every request of `page`: the virtual origin, the Auth emulator, the fake devnet RPC; anything else is aborted. */
export async function routeLocalDevnet(page: Page, webDir: string, authHost: string, blocked: string[]) {
  // Playwright matches the most recently registered route first: the catch-all goes first.
  await page.route('**/*', (route) => {
    blocked.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  // The vault accounts are read synchronously by the RPC double, so they are fetched ahead per request
  // (registered after it, so it runs first and then falls back to it).
  const accounts = new Map<string, FakeAccount | null>();
  await routeDevnetRpc(page, { account: (a) => accounts.get(a) ?? null });
  await page.route('https://api.devnet.solana.com/**', async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}') as { method?: string; params?: unknown[] };
    if (body.method === 'getAccountInfo') {
      const a = String(body.params?.[0]);
      const r = (await (await fetch(`${BACKEND}/__harness/vault-account?address=${a}`)).json()) as { owner: string; dataB64: string } | null;
      accounts.set(a, r ? { owner: r.owner, data: base64.decode(r.dataB64) } : null);
    }
    return route.fallback();
  });
  // Firebase Auth (web SDK; the devnet API gives no emulator config) → the Auth emulator, same paths.
  for (const host of ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com']) {
    await page.route(`https://${host}/**`, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const res = await fetch(`http://${authHost}/${host}${u.pathname}${u.search}`, { method: req.method(), headers: { 'content-type': req.headers()['content-type'] ?? 'application/json' }, body: req.postData() ?? undefined });
      await route.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'access-control-allow-origin': '*' }, body: Buffer.from(await res.arrayBuffer()) });
    });
  }
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
      const headers = { ...req.headers() };
      delete headers['content-length'];
      const payload = req.postDataBuffer();
      const r = await fetch(`${BACKEND}${u.pathname.slice(4)}${u.search}`, { method: req.method(), headers, body: payload ? new Uint8Array(payload) : undefined });
      const out: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        if (k !== 'content-length' && k !== 'transfer-encoding' && k !== 'content-encoding') out[k] = v;
      });
      return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
    }
    const path = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(webDir, path);
    if (!(file === webDir || file.startsWith(webDir + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(webDir, 'index.html');
    return route.fulfill({ status: 200, headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }, body: readFileSync(file) });
  });
}
