import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UploadIntent } from '@pocket-qa/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { r2Store } from '../src/storage/r2';
import { deleteOrQueue } from '../src/storage/sweep';
import type { EvidenceStore } from '../src/storage/types';
import { FakeRpc, MP4, PNG } from '../test/helpers';

/**
 * LIVE check of Hamza's scoped deletion policy (A5, 2026-10-04) on the real bucket. Skipped
 * unless POCKETQA_LIVE_R2_DELETE=1 with POCKETQA_R2_* in the environment (never printed).
 * Only objects THIS run creates are deleted, through the app's own paths (failed upload and
 * account deletion; a successful upload's quarantine copy is kept until account deletion). Every object already in the bucket must be exactly
 * unchanged afterwards (same keys, ETags and sizes); a listing (read-only, test-side only)
 * is compared before and after. The app adapter itself has no listing.
 */
const LIVE = process.env.POCKETQA_LIVE_R2_DELETE === '1';
const EXPECTED_ACCOUNT_SHA256 = '3346eba5537946d4f342e694a1c446db4cd874fa9e974acded242a1d438d99f3';
const d = LIVE ? describe : describe.skip;
const RUN = `del${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const created: string[] = [];
const deleted: string[] = [];

type Snapshot = Map<string, string>;

d('live R2: scoped deletion of app-created objects only', () => {
  const env = process.env as Record<string, string | undefined>;
  const dir = mkdtempSync(join(tmpdir(), 'pqa-live-r2-del-'));
  let config: ReturnType<typeof loadConfig>;
  let store: EvidenceStore;
  let lister: S3Client;

  async function snapshot(): Promise<Snapshot> {
    const out: Snapshot = new Map();
    let token: string | undefined;
    do {
      const r = await lister.send(new ListObjectsV2Command({ Bucket: config.r2!.bucket, ContinuationToken: token }));
      for (const o of r.Contents ?? []) out.set(o.Key!, `${o.ETag} ${o.Size}`);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  beforeAll(() => {
    // Non-production synthetic run with the scoped policy on (not retention-only).
    config = loadConfig({ ...env, POCKETQA_ENV: 'development', POCKETQA_DATA_DIR: dir, POCKETQA_STORAGE: 'r2', POCKETQA_R2_RETAIN_NONPROD: '0', POCKETQA_R2_ALLOW_DELETE: '1' });
    if (config.r2!.bucket !== 'pocketqa-evidence') throw new Error(`refusing to run against bucket ${config.r2!.bucket}`);
    if (createHash('sha256').update(config.r2!.accountId).digest('hex') !== EXPECTED_ACCOUNT_SHA256) throw new Error('refusing: not the expected Cloudflare account');
    const real = r2Store(config.r2!);
    store = { ...real, kind: real.kind, canDelete: real.canDelete, delete: async (key) => (await real.delete(key), void deleted.push(key)) };
    lister = new S3Client({ region: 'auto', endpoint: config.r2!.endpoint, forcePathStyle: true, credentials: { accessKeyId: config.r2!.accessKeyId, secretAccessKey: config.r2!.secretAccessKey } });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    console.log(`LIVE_R2_DELETE_CREATED ${JSON.stringify(created)}`);
    console.log(`LIVE_R2_DELETE_DELETED ${JSON.stringify(deleted)}`);
  });

  it('failed-upload and account-deletion paths delete exactly the run’s objects; a successful upload’s copy is kept until then; everything else is unchanged', async () => {
    const before = await snapshot();
    console.log(`LIVE_R2_DELETE_BEFORE ${before.size} objects`);
    mkdirSync(join(dir, 'media'), { recursive: true });
    const db = openDb(join(dir, 'live.sqlite'));
    const deps = { db, config, now: Date.now, rpc: new FakeRpc(), mediaDir: join(dir, 'media'), identity: null, store, settlement: null };
    const app = await buildApp(deps);
    await app.ready();
    const req = async (method: string, url: string, token?: string, payload?: unknown) => {
      const r = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
      return { status: r.statusCode, body: r.json() };
    };
    const reg = async (role: 'tester' | 'builder') =>
      (await req('POST', '/auth/register', undefined, { email: `${role}-${RUN}@example.test`, password: 'correct horse battery staple', displayName: role, role })).body.token as string;
    const builder = await reg('builder');
    const tester = await reg('tester');
    await req('POST', '/me/credits/test-topup', builder, { amount: 100 });
    const study = (
      await req('POST', '/studies', builder, {
        title: 'Live scoped deletion check',
        objective: 'Verify that only app-created evidence objects are deleted.',
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
    const intent = async (seg: string, sizeBytes: number) =>
      UploadIntent.parse((await req('POST', `/participations/${p.id}/evidence/upload-intents`, tester, { kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes, capturedOn: 'android', clientSegmentId: `${RUN}-${seg}` })).body);

    // 1. A good upload: promoted; its quarantine copy is KEPT (not a failed upload).
    const ok = await intent('ok', MP4.length);
    expect((await fetch(ok.uploadUrl, { method: 'PUT', headers: ok.headers, body: MP4 })).status).toBe(200);
    created.push(`quarantine/${ok.id}`);
    const ev = await req('POST', `/evidence/upload-intents/${ok.id}/complete`, tester);
    expect(ev.status).toBe(200);
    created.push(`evidence/${ev.body.id}`);
    expect((await store.head(`quarantine/${ok.id}`))?.size).toBe(MP4.length);
    expect((await store.head(`evidence/${ev.body.id}`))?.size).toBe(MP4.length);
    expect(deleted).toEqual([]);

    // 2. A spoofed upload: rejected, and its quarantine object deleted (failed_upload).
    const bad = await intent('bad', PNG.length);
    expect((await fetch(bad.uploadUrl, { method: 'PUT', headers: bad.headers, body: PNG })).status).toBe(200);
    created.push(`quarantine/${bad.id}`);
    expect((await req('POST', `/evidence/upload-intents/${bad.id}/complete`, tester)).status).toBe(400);
    expect(await store.head(`quarantine/${bad.id}`)).toBeNull();

    // 3. A pre-existing object (not created by this app's database) is refused, even by name.
    const foreign = [...before.keys()].find((k) => /^(evidence|quarantine)\//.test(k));
    if (foreign) expect(await deleteOrQueue(deps, foreign, 'account_deletion')).toBe(false);

    // 4. The tester deletes their account: the recording and its kept quarantine copy are deleted.
    await req('POST', `/participations/${p.id}/withdraw`, tester, {});
    expect((await req('DELETE', '/me', tester, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(await store.head(`evidence/${ev.body.id}`)).toBeNull();
    expect(await store.head(`quarantine/${ok.id}`)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get()).toEqual({ n: 0 });
    await app.close();
    db.close();

    // Exactly the run's objects were deleted, and the bucket is otherwise identical.
    expect([...deleted].sort()).toEqual([...created].sort());
    const after = await snapshot();
    console.log(`LIVE_R2_DELETE_AFTER ${after.size} objects`);
    expect(after).toEqual(before);
  });
});
