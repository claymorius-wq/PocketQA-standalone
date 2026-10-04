import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { makeApp, type TestApp } from './helpers';

// Ledger O1, O4, O6: readiness, clean stop and restart, and per-client limits behind the
// local proxy.
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close().catch(() => {});
  t = undefined;
});

const address = () => base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));

describe('trusted proxy (per-client rate limits behind the tunnel)', () => {
  it('config: production trusts only the loopback proxy by default; development trusts none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-ops-'));
    expect(loadConfig({ POCKETQA_DATA_DIR: dir }).trustProxy).toBe(false);
    expect(loadConfig({ POCKETQA_DATA_DIR: dir, POCKETQA_TRUST_PROXY: 'loopback' }).trustProxy).toEqual(['127.0.0.1', '::1']);
    expect(() => loadConfig({ POCKETQA_DATA_DIR: dir, POCKETQA_TRUST_PROXY: '0.0.0.0/0' })).toThrow(/TRUST_PROXY/);
  });

  it('with the loopback proxy trusted, two clients behind it get separate limits', async () => {
    t = await makeApp({ walletLogin: true, trustProxy: true });
    const a = address();
    const ask = (ip: string) => t!.req('POST', '/auth/wallet/challenge', undefined, { address: a }, { 'x-forwarded-for': ip });
    for (let i = 0; i < 5; i++) expect((await ask('203.0.113.7')).status).toBe(200);
    expect((await ask('203.0.113.7')).status).toBe(429);
    expect((await ask('198.51.100.9')).status).toBe(200);
  });

  it('without trust, X-Forwarded-For is ignored (a client cannot dodge its limit by forging it)', async () => {
    t = await makeApp({ walletLogin: true });
    const a = address();
    for (let i = 0; i < 5; i++) expect((await t.req('POST', '/auth/wallet/challenge', undefined, { address: a }, { 'x-forwarded-for': `203.0.113.${i}` })).status).toBe(200);
    expect((await t.req('POST', '/auth/wallet/challenge', undefined, { address: a }, { 'x-forwarded-for': '198.51.100.9' })).status).toBe(429);
  });
});

describe('readiness', () => {
  it('/health fails when the database cannot answer', async () => {
    t = await makeApp();
    expect((await t.req('GET', '/health')).status).toBe(200);
    t.db.close();
    expect((await t.req('GET', '/health')).status).toBe(500);
    t = undefined; // already closed its database
  });
});

describe('process supervision: clean stop and restart (real server process)', () => {
  const start = (dir: string, port: number) =>
    spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: join(import.meta.dirname, '..'),
      env: { PATH: process.env.PATH!, HOME: process.env.HOME!, POCKETQA_DATA_DIR: dir, POCKETQA_API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const up = async (port: number) => {
    for (let i = 0; i < 60; i++) {
      if (await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
  };

  it('SIGTERM exits 0 after closing; a restart serves the same data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-proc-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const first = start(dir, port);
    await up(port);
    const reg = await fetch(`http://127.0.0.1:${port}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'restart@example.test', password: 'correct horse battery staple', displayName: 'R', role: 'tester' }),
    });
    expect(reg.status).toBe(200);
    // A restore is refused while the API answers on its port.
    const restore = spawnSync('npx', ['tsx', 'scripts/restore-db.ts', '--from', join(dir, 'pocketqa.sqlite')], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH!, HOME: process.env.HOME!, POCKETQA_DATA_DIR: dir, POCKETQA_API_PORT: String(port) },
    });
    expect([restore.status, restore.stderr]).toEqual([1, expect.stringMatching(/Stop it before restoring/)]);
    // Also refused when probing a different port: the pid file names the live API.
    const otherPort = spawnSync('npx', ['tsx', 'scripts/restore-db.ts', '--from', join(dir, 'pocketqa.sqlite')], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH!, HOME: process.env.HOME!, POCKETQA_DATA_DIR: dir, POCKETQA_API_PORT: String(port + 1) },
    });
    expect([otherPort.status, otherPort.stderr]).toEqual([1, expect.stringMatching(/pid file/)]);
    const exited = new Promise<number | null>((resolve) => first.once('exit', (code) => resolve(code)));
    first.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(await fetch(`http://127.0.0.1:${port}/health`).then(() => 'up', () => 'down')).toBe('down');
    expect(existsSync(join(dir, 'api.pid'))).toBe(false); // removed on clean shutdown

    const second = start(dir, port);
    try {
      await up(port);
      const login = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'restart@example.test', password: 'correct horse battery staple' }),
      });
      expect(login.status).toBe(200);
    } finally {
      const done = new Promise((resolve) => second.once('exit', resolve));
      second.kill('SIGTERM');
      await done;
    }
  }, 90_000);
});
