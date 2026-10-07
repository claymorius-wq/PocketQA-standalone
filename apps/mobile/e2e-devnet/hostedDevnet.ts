import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';

// HOSTED devnet run helpers (real Solana devnet; test tooling, never app code).
// - The fixture key is read from ~/.config/pocketqa-devnet-pilot/<role>.json into this process
//   only and checked against public-addresses.json. Only the 32-byte seed is returned; callers
//   never print it, never put it in an env, never write it.
// - `devnetSend` broadcasts the wallet-signed bytes to a devnet RPC after proving the cluster by
//   its genesis hash (no mainnet path exists here).
// - `recordEvidence` keeps console errors/warnings and every request's method, origin+path and
//   status. Query strings are DROPPED: presigned storage URLs are bearer links.
const FIXTURES = join(homedir(), '.config', 'pocketqa-devnet-pilot');
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export function loadFixtureSeed(role: 'builder' | 'tester' | 'outsider'): { seed: Uint8Array; address: string } {
  const raw = JSON.parse(readFileSync(join(FIXTURES, `${role}.json`), 'utf8')) as number[] | { secretKey?: number[] };
  const bytes = Uint8Array.from(Array.isArray(raw) ? raw : (raw.secretKey ?? []));
  if (bytes.length !== 64) throw new Error(`fixture ${role}: expected a 64-byte secret key`);
  const seed = bytes.slice(0, 32);
  bytes.fill(0);
  const address = base58.encode(ed25519.getPublicKey(seed));
  const published = (JSON.parse(readFileSync(join(FIXTURES, 'public-addresses.json'), 'utf8')) as Record<string, string>)[role];
  if (published !== address) throw new Error(`fixture ${role}: the key does not match public-addresses.json`);
  return { seed, address };
}

export function devnetSend(rpcUrl: string) {
  if (!/^https:\/\//.test(rpcUrl)) throw new Error('devnet RPC must be https');
  const rpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = (await r.json()) as { result?: T; error?: { message: string } };
    if (j.error || j.result === undefined) throw new Error(`${method}: ${j.error?.message ?? r.status}`);
    return j.result;
  };
  let proven = false;
  return async (signed: Uint8Array): Promise<string> => {
    if (!proven) {
      if ((await rpc<string>('getGenesisHash', [])) !== DEVNET_GENESIS) throw new Error('refusing: the RPC is not Solana devnet');
      proven = true;
    }
    return rpc<string>('sendTransaction', [base64.encode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  };
}

export type Evidence = { console: { type: string; text: string }[]; network: { method: string; url: string; status: number | null; failure?: string }[] };
const strip = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u.slice(0, 120);
  }
};
export function recordEvidence(page: Page): Evidence {
  const ev: Evidence = { console: [], network: [] };
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') ev.console.push({ type: m.type(), text: m.text().replace(/https?:\/\/\S+\?\S+/g, (u) => strip(u)).slice(0, 500) });
  });
  page.on('pageerror', (e) => ev.console.push({ type: 'pageerror', text: e.message.slice(0, 500) }));
  page.on('response', (r) => {
    if (!r.url().startsWith('data:')) ev.network.push({ method: r.request().method(), url: strip(r.url()), status: r.status() });
  });
  page.on('requestfailed', (r) => ev.network.push({ method: r.method(), url: strip(r.url()), status: null, failure: r.failure()?.errorText ?? 'failed' }));
  return ev;
}
export function writeEvidence(ev: Evidence, file: string) {
  writeFileSync(file, JSON.stringify(ev, null, 1));
}
