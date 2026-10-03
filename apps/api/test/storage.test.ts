import { afterEach, describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES, UPLOAD_INTENT_TTL_SECONDS, UploadIntent } from '@pocket-qa/contracts';
import { sweepStorage } from '../src/storage/sweep';
import { makeApp, MP4, PNG, seeded, type TestApp } from './helpers';

// ADR 0005 §3: private evidence storage with direct uploads. Uses the real R2 (S3) adapter
// against a local fake S3 server; real R2 remains a named provider gate.
let t: TestApp;
afterEach(async () => t.close());

const meta = (over: Record<string, unknown> = {}) => ({ kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes: MP4.length, capturedOn: 'android', clientSegmentId: 'seg-1', ...over });

async function put(intent: UploadIntent, body: Buffer) {
  return fetch(intent.uploadUrl, { method: 'PUT', headers: intent.headers, body });
}

async function intentFor(token: string, participationId: string, over: Record<string, unknown> = {}) {
  const r = await t.req('POST', `/participations/${participationId}/evidence/upload-intents`, token, meta(over));
  return r;
}

describe('direct uploads to private storage (r2 mode)', () => {
  it('intent → presigned PUT to a quarantine key → server-verified completion → private playback with ranges', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    expect((await t.req('GET', '/config')).body.storage).toBe('r2');
    const r = await intentFor(s.tester.token, s.participationId);
    expect(r.status).toBe(200);
    const intent = UploadIntent.parse(r.body);
    expect(intent.uploadUrl).toMatch(/\/pqa-test\/quarantine\/[A-Za-z0-9_-]+\?/);
    expect(intent.uploadUrl).toMatch(/X-Amz-Signature=/);
    expect(intent.headers).toEqual({ 'content-type': 'video/mp4' });
    expect((await put(intent, MP4)).status).toBe(200);
    expect(t.s3.puts[0]!.signedHeaders).toMatch(/content-length/);
    expect(t.s3.puts[0]!.signedHeaders).toMatch(/content-type/);

    const done = await t.req('POST', `/evidence/upload-intents/${intent.id}/complete`, s.tester.token);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ mimeType: 'video/mp4', sizeBytes: MP4.length, kind: 'screen_recording' });
    // Promoted to an immutable final key; the quarantine copy is gone.
    expect(t.s3.keys()).toEqual([`pqa-test/evidence/${done.body.id}`]);

    const list = await t.req('GET', `/participations/${s.participationId}/evidence`, s.builder.token);
    expect(list.body.items.map((e: { id: string }) => e.id)).toEqual([done.body.id]);
    const pt = await t.req('POST', `/evidence/${done.body.id}/playback-token`, s.builder.token);
    const full = await t.req('GET', `/media/${pt.body.token}`);
    expect(full.status).toBe(200);
    expect(Buffer.compare(full.raw, MP4)).toBe(0);
    const part = await t.req('GET', `/media/${pt.body.token}`, undefined, undefined, { range: 'bytes=4-11' });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 4-11/${MP4.length}`);
    expect(part.raw.toString('latin1')).toBe('ftypmp42');
  });

  it('the multipart route is off in r2 mode, and intents are off in local mode', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    expect((await t.upload(s.tester.token, s.participationId, MP4, { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'm1' })).status).toBe(409);
    const local = await makeApp();
    const l = await seeded(local);
    expect((await local.req('POST', `/participations/${l.participationId}/evidence/upload-intents`, l.tester.token, meta())).status).toBe(409);
    await local.close();
  });

  it('an intent is idempotent per segment, and only the owning tester can create or complete it', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const a = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    const b = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    expect(b.id).toBe(a.id);
    const other = await t.register('tester');
    expect((await intentFor(other.token, s.participationId)).status).toBe(404);
    await put(a, MP4);
    expect((await t.req('POST', `/evidence/upload-intents/${a.id}/complete`, other.token)).status).toBe(404);
    expect((await t.req('POST', `/evidence/upload-intents/${a.id}/complete`, s.builder.token)).status).toBe(403);
  });

  it('rejects a spoofed type or a size that differs from the declaration, and deletes the object', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const spoof = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { sizeBytes: PNG.length })).body);
    await put(spoof, PNG); // declared video/mp4, actually a PNG
    const r1 = await t.req('POST', `/evidence/upload-intents/${spoof.id}/complete`, s.tester.token);
    expect(r1.status).toBe(400);
    const sized = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { clientSegmentId: 'seg-2', sizeBytes: MP4.length + 10 })).body);
    await fetch(sized.uploadUrl, { method: 'PUT', headers: sized.headers, body: MP4 }); // fake S3 does not enforce the signed length
    const r2 = await t.req('POST', `/evidence/upload-intents/${sized.id}/complete`, s.tester.token);
    expect(r2.status).toBe(400);
    expect(t.s3.keys()).toEqual([]);
    expect((await t.req('GET', `/participations/${s.participationId}/evidence`, s.tester.token)).body.items).toEqual([]);
    // A rejected intent cannot be completed later.
    expect((await t.req('POST', `/evidence/upload-intents/${spoof.id}/complete`, s.tester.token)).status).toBe(409);
  });

  it('completing before the bytes arrive is a retryable conflict', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(409);
    await put(i, MP4);
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(200);
  });

  it('pending reservations count toward the byte quota', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    for (let i = 0; i < 5; i += 1) expect((await intentFor(s.tester.token, s.participationId, { clientSegmentId: `big-${i}`, sizeBytes: MAX_EVIDENCE_BYTES })).status).toBe(200);
    expect((await intentFor(s.tester.token, s.participationId, { clientSegmentId: 'big-6', sizeBytes: 1000 })).status).toBe(413);
  });

  it('submission is blocked while uploads are pending; completion after submission is refused', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    const blocked = await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token);
    expect(blocked.status).toBe(409);
    await put(i, MP4);
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(200);
    expect((await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token)).status).toBe(200);
  });

  it('expired intents are refused and swept, including bytes re-uploaded after completion', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const done = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(done, MP4);
    const ev = (await t.req('POST', `/evidence/upload-intents/${done.id}/complete`, s.tester.token)).body;
    await put(done, PNG); // URL still valid: a re-PUT lands in quarantine only, never on the final object
    const stale = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { clientSegmentId: 'seg-late' })).body);
    await put(stale, MP4);
    t.clock.now += UPLOAD_INTENT_TTL_SECONDS * 1000 + 1;
    expect((await t.req('POST', `/evidence/upload-intents/${stale.id}/complete`, s.tester.token)).status).toBe(409);
    await sweepStorage(t.deps);
    expect(t.s3.keys()).toEqual([`pqa-test/evidence/${ev.id}`]);
    const pt = await t.req('POST', `/evidence/${ev.id}/playback-token`, s.tester.token);
    expect(Buffer.compare((await t.req('GET', `/media/${pt.body.token}`)).raw, MP4)).toBe(0);
  });

  it('bytes swapped after validation never become evidence (ETag pinning, review r1 P3)', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(i, MP4);
    // Same length and type, different bytes, PUT with the still-valid URL right after HEAD.
    const swapped = Buffer.from(MP4);
    swapped[swapped.length - 1] = 0x7f;
    const head = t.deps.store.head.bind(t.deps.store);
    let once = true;
    t.deps.store.head = async (key) => {
      const h = await head(key);
      if (once && key.startsWith('quarantine/')) {
        once = false;
        await put(i, swapped);
      }
      return h;
    };
    const first = await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token);
    expect(first.status).toBe(409); // changed under us: retryable, nothing recorded
    expect((await t.req('GET', `/participations/${s.participationId}/evidence`, s.tester.token)).body.items).toEqual([]);
    expect(t.s3.keys().filter((k) => k.startsWith('pqa-test/evidence/'))).toEqual([]);
    // Completing again validates the bytes that are actually stored now.
    const second = await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token);
    expect(second.status).toBe(200);
    const pt = await t.req('POST', `/evidence/${second.body.id}/playback-token`, s.tester.token);
    expect(Buffer.compare((await t.req('GET', `/media/${pt.body.token}`)).raw, swapped)).toBe(0);
  });

  it('a missing version tag is a retryable conflict, never an unpinned completion (review r2 P3)', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(i, MP4);
    const head = t.deps.store.head.bind(t.deps.store);
    t.deps.store.head = async (key) => {
      const h = await head(key);
      return h ? { ...h, etag: '' } : h;
    };
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(409);
    t.deps.store.head = head;
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(200);
  });

  it('concurrent completions of one intent create one evidence item', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(i, MP4);
    const results = await Promise.all([1, 2, 3].map(() => t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(t.db.prepare('SELECT status FROM upload_intents WHERE id = ?').get(i.id)).toEqual({ status: 'completed' });
    expect((await t.req('GET', `/participations/${s.participationId}/evidence`, s.tester.token)).body.items).toHaveLength(1);
    expect(t.s3.keys().filter((k) => k.startsWith('pqa-test/evidence/'))).toHaveLength(1);
  });

  it('account deletion removes stored objects, retrying through the outbox when the provider fails', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(i, MP4);
    await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token);
    await t.req('POST', `/participations/${s.participationId}/withdraw`, s.tester.token, {});
    t.s3.failDeletes = true;
    expect((await t.req('DELETE', '/me', s.tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(t.s3.keys()).toHaveLength(1);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get()).toEqual({ n: 1 });
    t.s3.failDeletes = false;
    t.clock.now += 120_000;
    await sweepStorage(t.deps);
    expect(t.s3.keys()).toEqual([]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get()).toEqual({ n: 0 });
  });
});

describe('client config never exposes storage credentials', () => {
  it('reports only the storage mode', async () => {
    t = await makeApp({ storage: 'r2' });
    const body = JSON.stringify((await t.req('GET', '/config')).body);
    expect(body).not.toMatch(/test-key-id|test-secret-key|pqa-test|r2\.cloudflarestorage|127\.0\.0\.1/);
  });
});
