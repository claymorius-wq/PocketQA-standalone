import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UploadIntent } from '@pocket-qa/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { r2Store } from '../src/storage/r2';
import { readHead, StorageChanged, type EvidenceStore } from '../src/storage/types';
import { FakeRpc, MP4, PNG } from '../test/helpers';

/**
 * LIVE Cloudflare R2 checks (ADR 0005 §3 provider gate). Skipped unless POCKETQA_LIVE_R2=1
 * with POCKETQA_R2_* in the environment (never committed, never printed).
 * Hard rules (Hamza): only the dedicated `pocketqa-evidence` bucket, only NEW objects, and
 * NO deletion of anything, so every delete is intercepted and recorded, never sent.
 */
const LIVE = process.env.POCKETQA_LIVE_R2 === '1';
// The Optijara Cloudflare account, pinned by hash so the id itself never enters the repo:
// a same-named bucket in any other account is refused.
const EXPECTED_ACCOUNT_SHA256 = '3346eba5537946d4f342e694a1c446db4cd874fa9e974acded242a1d438d99f3';
const d = LIVE ? describe : describe.skip;
const RUN = `live${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const created: string[] = [];
const refusedDeletes: string[] = [];

/** The real store with deletion made impossible: deletes are recorded and refused. */
function noDelete(store: EvidenceStore): EvidenceStore {
  return {
    ...store,
    kind: store.kind,
    canDelete: false,
    head: store.head.bind(store),
    readRange: store.readRange.bind(store),
    copy: async (src, dst, opts) => {
      await store.copy(src, dst, opts);
      created.push(dst);
    },
    presignPut: store.presignPut.bind(store),
    delete: async (key) => {
      refusedDeletes.push(key);
      throw new Error('deletion is disabled in live tests');
    },
  };
}

d('live R2: dedicated bucket, create-only', () => {
  const env = process.env as Record<string, string | undefined>;
  const dir = mkdtempSync(join(tmpdir(), 'pqa-live-r2-'));
  let config: ReturnType<typeof loadConfig>;
  let store: EvidenceStore;

  beforeAll(() => {
    // Synthetic objects only, retained (Hamza: no R2 deletion); never POCKETQA_R2_ALLOW_DELETE here.
    config = loadConfig({ ...env, POCKETQA_DATA_DIR: dir, POCKETQA_STORAGE: 'r2', POCKETQA_R2_RETAIN_NONPROD: '1', POCKETQA_R2_ALLOW_DELETE: '0' });
    // Never anything but the dedicated bucket (other buckets hold unrelated production assets).
    if (config.r2!.bucket !== 'pocketqa-evidence') throw new Error(`refusing to run against bucket ${config.r2!.bucket}`);
    if (createHash('sha256').update(config.r2!.accountId).digest('hex') !== EXPECTED_ACCOUNT_SHA256) throw new Error('refusing: not the expected Cloudflare account');
    store = noDelete(r2Store(config.r2!));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    console.log(`LIVE_R2_CREATED ${JSON.stringify(created)}`);
    console.log(`LIVE_R2_REFUSED_DELETES ${JSON.stringify(refusedDeletes)}`);
  });

  it('presigned PUT with the exact signed type and length → HEAD → ranged read', async () => {
    const key = `quarantine/${RUN}a`;
    const { url, headers } = await store.presignPut(key, { contentType: 'video/mp4', contentLength: MP4.length, expiresInSeconds: 300 });
    const put = await fetch(url, { method: 'PUT', headers, body: MP4 });
    expect(put.status).toBe(200);
    created.push(key);
    const head = await store.head(key);
    expect(head?.size).toBe(MP4.length);
    expect(head?.etag).toMatch(/^"?[0-9a-f-]+"?$/);
    expect((await readHead(store, key, 12, { ifMatch: head!.etag })).subarray(4, 12).toString('latin1')).toBe('ftypmp42');
  });

  it('R2 enforces the signed headers: a different length or type is refused and creates nothing', async () => {
    const key = `quarantine/${RUN}b`;
    const { url } = await store.presignPut(key, { contentType: 'video/mp4', contentLength: MP4.length, expiresInSeconds: 300 });
    const longer = await fetch(url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: Buffer.concat([MP4, Buffer.alloc(10)]) });
    expect(longer.status).toBeGreaterThanOrEqual(400);
    const otherType = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: MP4 });
    expect(otherType.status).toBeGreaterThanOrEqual(400);
    expect(await store.head(key)).toBeNull();
  });

  it('copy is pinned to the version inspected (ETag); a stale version is refused', async () => {
    const src = `quarantine/${RUN}a`;
    const head = await store.head(src);
    const dst = `evidence/${RUN}a`;
    await store.copy(src, dst, { ifMatch: head!.etag });
    expect((await store.head(dst))?.size).toBe(MP4.length);
    await expect(store.copy(src, `evidence/${RUN}stale`, { ifMatch: '"00000000000000000000000000000000"' })).rejects.toBeInstanceOf(StorageChanged);
    expect(await store.head(`evidence/${RUN}stale`)).toBeNull();
  });

  it('objects are private: an anonymous GET is refused', async () => {
    const res = await fetch(`${config.r2!.endpoint}/${config.r2!.bucket}/quarantine/${RUN}a`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('full API flow against the real bucket: intent → presigned PUT → verified completion → ranged playback', async () => {
    mkdirSync(join(dir, 'media'), { recursive: true });
    const db = openDb(join(dir, 'live.sqlite'));
    const app = await buildApp({ db, config, now: Date.now, rpc: new FakeRpc(), mediaDir: join(dir, 'media'), identity: null, store });
    await app.ready();
    const req = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
      const r = await app.inject({ method: method as 'GET', url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
      let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        body = r.json();
      } catch {
        body = r.body;
      }
      return { status: r.statusCode, body, raw: r.rawPayload, headers: r.headers };
    };
    const reg = async (role: 'tester' | 'builder') =>
      (await req('POST', '/auth/register', undefined, { email: `${role}-${RUN}@example.test`, password: 'correct horse battery staple', displayName: role, role })).body.token as string;
    const builder = await reg('builder');
    const tester = await reg('tester');
    await req('POST', '/me/credits/test-topup', builder, { amount: 100 });
    const study = (
      await req('POST', '/studies', builder, {
        title: 'Live R2 check',
        objective: 'Verify private evidence storage end to end.',
        tasks: [{ instruction: 'Open the app' }],
        deviceCriteria: { platforms: ['android'], minAndroidApi: null, languages: [] },
        rewardCredits: 10,
        slots: 1,
        consentText: 'I agree to record my screen only while doing these tasks.',
      })
    ).body;
    await req('POST', `/studies/${study.id}/publish`, builder);
    await req('PUT', '/me/device', tester, { platform: 'android', osVersion: '16', androidApiLevel: 36, model: 'Live check', languages: ['en'] });
    const p = (await req('POST', `/studies/${study.id}/consent`, tester, { consentVersion: study.consentVersion, accepted: true })).body;
    await req('POST', `/participations/${p.id}/start`, tester);

    const intent = UploadIntent.parse((await req('POST', `/participations/${p.id}/evidence/upload-intents`, tester, { kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes: MP4.length, capturedOn: 'android', clientSegmentId: `${RUN}-seg` })).body);
    // Only the path is asserted: a failure must never print the signed URL (key id, signature).
    expect(new URL(intent.uploadUrl).pathname).toMatch(/^\/pocketqa-evidence\/quarantine\//);
    expect((await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.headers, body: MP4 })).status).toBe(200);
    created.push(`quarantine/${intent.id}`);
    const done = await req('POST', `/evidence/upload-intents/${intent.id}/complete`, tester);
    expect(done.status).toBe(200);
    // The quarantine delete was intercepted (no deletion) and queued in the outbox instead.
    expect(db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get()).toEqual({ n: 1 });

    const pt = (await req('POST', `/evidence/${done.body.id}/playback-token`, builder)).body;
    const full = await req('GET', `/media/${pt.token}`);
    expect(full.status).toBe(200);
    expect(Buffer.compare(full.raw, MP4)).toBe(0);
    const part = await req('GET', `/media/${pt.token}`, undefined, undefined, { range: 'bytes=4-11' });
    expect(part.status).toBe(206);
    expect(part.raw.toString('latin1')).toBe('ftypmp42');

    // A spoofed type is rejected; its quarantine object stays (no deletion) and is recorded.
    const spoof = UploadIntent.parse((await req('POST', `/participations/${p.id}/evidence/upload-intents`, tester, { kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes: PNG.length, capturedOn: 'android', clientSegmentId: `${RUN}-spoof` })).body);
    expect((await fetch(spoof.uploadUrl, { method: 'PUT', headers: spoof.headers, body: PNG })).status).toBe(200);
    created.push(`quarantine/${spoof.id}`);
    expect((await req('POST', `/evidence/upload-intents/${spoof.id}/complete`, tester)).status).toBe(400);
    await app.close();
    db.close();
  });
});
