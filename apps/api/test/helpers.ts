import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { SOLANA_DEVNET_GENESIS_HASH } from '@pocket-qa/contracts';
import type { ParsedTx } from '@pocket-qa/domain';
import { buildApp, loggerOptions } from '../src/app';
import type { Deps, DevnetRpc } from '../src/context';
import { openDb } from '../src/db';
import { localStore } from '../src/storage/local';
import { r2Store } from '../src/storage/r2';
import { FakeIdentity } from './fakeIdentity';
import { FakeS3 } from './fakeS3';

export const START = Date.parse('2026-10-02T12:00:00.000Z');

export class FakeRpc implements DevnetRpc {
  genesis = SOLANA_DEVNET_GENESIS_HASH;
  txs = new Map<string, ParsedTx | null>();
  fail = false;
  blockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
  async getLatestBlockhash() {
    if (this.fail) throw new Error('down');
    return { blockhash: this.blockhash, lastValidBlockHeight: 1000 };
  }
  async getGenesisHash() {
    if (this.fail) throw new Error('down');
    return this.genesis;
  }
  async getTransaction(sig: string) {
    if (this.fail) throw new Error('down');
    return this.txs.get(sig) ?? null;
  }
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export async function makeApp(opts: { captureLogs?: boolean; authMode?: 'local' | 'firebase'; walletLogin?: boolean; storage?: 'local' | 'r2' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pqa-api-'));
  const mediaDir = join(dir, 'media');
  mkdirSync(mediaDir);
  const db = openDb(join(dir, 'test.sqlite'));
  const clock = { now: START };
  const rpc = new FakeRpc();
  const authMode = opts.authMode ?? 'local';
  const identity = new FakeIdentity('demo-pocketqa', () => clock.now);
  const storage = opts.storage ?? 'local';
  const s3 = new FakeS3();
  const r2 = storage === 'r2' ? { accountId: '0'.repeat(32), bucket: 'pqa-test', endpoint: await s3.start(), accessKeyId: 'test-key-id', secretAccessKey: 'test-secret-key' } : null; // check-secrets: allow (fake S3 test credentials)
  const store = r2 ? r2Store(r2) : localStore(mediaDir);
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const deps: Deps = {
      db,
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir: dir,
        rpcUrl: 'http://fake',
        siwsDomain: 'pocketqa.local',
        aiProvider: null,
        authMode,
        firebase: authMode === 'firebase' ? { projectId: 'demo-pocketqa', webApiKey: 'demo-web-api-key', authDomain: 'demo-pocketqa.firebaseapp.com', authEmulatorHost: null } : null, // check-secrets: allow (placeholder public Firebase web config in tests)
        sharedDemo: false,
        walletLogin: opts.walletLogin ?? false,
        publicOrigin: opts.walletLogin ? 'https://app.pocketqa.example' : null,
        storage,
        r2,
      },
      store,
      identity: authMode === 'firebase' ? identity : null,
      now: () => clock.now,
      rpc,
      mediaDir,
    };
  const app = await buildApp(deps, opts.captureLogs ? { logger: loggerOptions(stream) } : {});
  await app.ready();

  async function req(method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}, remoteAddress?: string) {
    const res = await app.inject({
      method: method as 'GET',
      url,
      ...(remoteAddress ? { remoteAddress } : {}),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, headers: res.headers, raw: res.rawPayload };
  }

  let n = 0;
  async function register(role: 'tester' | 'builder', name: string = role) {
    n += 1;
    const r = await req('POST', '/auth/register', undefined, {
      email: `${name}${n}@example.test`,
      password: 'correct horse battery staple',
      displayName: `${name} ${n}`,
      role,
    });
    if (r.status !== 200) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
    return { token: r.body.token as string, id: r.body.user.id as string, email: r.body.user.email as string };
  }

  /** Admins are created out of band (CLI in production); tests insert one directly. */
  async function admin() {
    const a = await register('tester', 'admin');
    db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(a.id);
    return a;
  }

  async function upload(token: string, participationId: string, file: Buffer, meta: Record<string, unknown>) {
    const boundary = '----pqa' + Math.random().toString(16).slice(2);
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const payload = Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return req('POST', `/participations/${participationId}/evidence`, token, payload, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
  }

  return {
    app,
    db,
    clock,
    rpc,
    identity,
    deps,
    s3,
    store,
    logs,
    mediaDir,
    req,
    register,
    admin,
    upload,
    async close() {
      await app.close();
      if (r2) await s3.stop();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
export const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(256, 2)]);

export const STUDY = {
  title: 'Onboarding friction',
  objective: 'Find where first-time users get stuck creating an account.',
  tasks: [{ instruction: 'Create an account and reach the home screen' }, { instruction: 'Change the theme to dark' }],
  deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: 29, languages: ['en'] },
  rewardCredits: 50,
  slots: 2,
  consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.',
};

export const DEVICE = { platform: 'web', osVersion: 'Chrome 140', androidApiLevel: null, model: 'Desktop browser', languages: ['en-US'] };

/** Builder with a published study and a tester who is in progress on it. */
export async function seeded(t: TestApp) {
  const builder = await t.register('builder');
  const tester = await t.register('tester');
  await t.req('POST', '/me/credits/test-topup', builder.token, { amount: 1000 });
  const study = (await t.req('POST', '/studies', builder.token, STUDY)).body;
  await t.req('POST', `/studies/${study.id}/publish`, builder.token);
  await t.req('PUT', '/me/device', tester.token, DEVICE);
  const p = (await t.req('POST', `/studies/${study.id}/consent`, tester.token, { consentVersion: 1, accepted: true })).body;
  await t.req('POST', `/participations/${p.id}/start`, tester.token);
  return { builder, tester, study, participationId: p.id as string };
}
