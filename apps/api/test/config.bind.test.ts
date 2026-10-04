import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app';
import { ConfigError, loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { localStore } from '../src/storage/local';
import { FakeRpc } from './helpers';

describe('local-only configuration', () => {
  it('refuses any non-loopback host', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.20', 'localhost', 'example.com']) {
      expect(() => loadConfig({ POCKETQA_API_HOST: host }), host).toThrowError(ConfigError);
    }
    expect(loadConfig({}).host).toBe('127.0.0.1');
    expect(loadConfig({ POCKETQA_API_HOST: '::1' }).host).toBe('::1');
  });

  it('refuses a data directory inside the repo that git would track', () => {
    expect(() => loadConfig({ POCKETQA_DATA_DIR: 'packages' })).toThrowError(/not git-ignored/);
    expect(() => loadConfig({ POCKETQA_DATA_DIR: '.' })).toThrowError(/not git-ignored/);
    expect(loadConfig({ POCKETQA_DATA_DIR: 'apps/api/.data' }).dataDir).toMatch(/apps\/api\/\.data$/);
    expect(loadConfig({ POCKETQA_DATA_DIR: tmpdir() }).dataDir).toBeTruthy();
  });

  it('the server actually listens on loopback only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-bind-'));
    const config = loadConfig({ POCKETQA_DATA_DIR: dir, POCKETQA_API_PORT: '0' });
    const db = openDb(join(dir, 'x.sqlite'));
    const app = await buildApp({ db, config, now: Date.now, rpc: new FakeRpc(), mediaDir: dir, identity: null, store: localStore(dir), settlement: null });
    await app.listen({ host: config.host, port: config.port });
    const addrs = app.addresses();
    expect(addrs.length).toBeGreaterThan(0);
    expect(addrs.every((a) => a.address === '127.0.0.1')).toBe(true);
    const res = await fetch(`http://127.0.0.1:${addrs[0]!.port}/health`);
    expect(await res.json()).toMatchObject({ ok: true });
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
