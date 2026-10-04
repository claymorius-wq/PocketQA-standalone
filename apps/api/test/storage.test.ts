import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES, UPLOAD_INTENT_TTL_SECONDS, UploadIntent } from '@pocket-qa/contracts';
import { MIGRATION_COUNT, openDb } from '../src/db';
import { deleteOrQueue, sweepStorage } from '../src/storage/sweep';
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

describe('R2 deletion guard (default off)', () => {
  it('with deletion not allowed, no object is ever deleted: deletes are kept in the outbox', async () => {
    t = await makeApp({ storage: 'r2', r2AllowDelete: false });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(i, MP4);
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(200);
    t.clock.now += UPLOAD_INTENT_TTL_SECONDS * 1000 + 120_000;
    await sweepStorage(t.deps);
    // Quarantine and promoted objects both still exist; the quarantine delete waits in the outbox.
    expect(t.s3.keys().sort()).toEqual([`pqa-test/evidence/${(await t.req('GET', `/participations/${s.participationId}/evidence`, s.tester.token)).body.items[0].id}`, `pqa-test/quarantine/${i.id}`].sort());
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get() as { n: number }).n).toBeGreaterThan(0);
  });

  it('with deletion not allowed, account deletion fails closed: refused, nothing changed, objects kept', async () => {
    t = await makeApp({ storage: 'r2', r2AllowDelete: false });
    const s = await seeded(t);
    const i = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(i, MP4);
    await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token);
    await t.req('POST', `/participations/${s.participationId}/withdraw`, s.tester.token, {});
    const before = t.s3.keys().sort();
    const r = await t.req('DELETE', '/me', s.tester.token, { confirm: 'DELETE MY ACCOUNT' });
    expect([r.status, r.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(r.body.message).toMatch(/recordings can’t be erased/);
    expect((await t.req('GET', '/me', s.tester.token)).status).toBe(200);
    expect(t.s3.keys().sort()).toEqual(before);
  });
});

// Hamza's scoped deletion policy (A5, 2026-10-04): Pocket QA deletes only objects it created
// itself, only in its own bucket, only for failed-upload cleanup, upload staging and
// user-requested account deletion. Nothing time-expires stored evidence; no lifecycle.
describe('scoped deletion: only objects the app created', () => {
  const FOREIGN = ['pqa-test/evidence/foreign-fixture-0001', 'pqa-test/quarantine/foreign-fixture-0002', 'pqa-test/blog/asset.png'];
  const plant = () => {
    for (const k of FOREIGN) t.s3.objects.set(k, { body: Buffer.from(`fixture ${k}`), contentType: 'application/octet-stream' });
  };

  it('objects the app did not create survive rejection, completion, the sweep and account deletion', async () => {
    t = await makeApp({ storage: 'r2' });
    plant();
    const s = await seeded(t);
    const spoof = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { sizeBytes: PNG.length })).body);
    await put(spoof, PNG);
    expect((await t.req('POST', `/evidence/upload-intents/${spoof.id}/complete`, s.tester.token)).status).toBe(400);
    const ok = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { clientSegmentId: 'seg-ok' })).body);
    await put(ok, MP4);
    expect((await t.req('POST', `/evidence/upload-intents/${ok.id}/complete`, s.tester.token)).status).toBe(200);
    t.clock.now += UPLOAD_INTENT_TTL_SECONDS * 1000 + 120_000;
    await sweepStorage(t.deps);
    await t.req('POST', `/participations/${s.participationId}/withdraw`, s.tester.token, {});
    expect((await t.req('DELETE', '/me', s.tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    // Every object the app created is gone; every other object is untouched.
    expect(t.s3.keys().sort()).toEqual([...FOREIGN].sort());
    for (const k of FOREIGN) expect(t.s3.objects.get(k)!.body.toString()).toBe(`fixture ${k}`);
  });

  it('an unregistered key is never deleted or queued, even when a caller names it', async () => {
    t = await makeApp({ storage: 'r2' });
    plant();
    for (const k of ['evidence/foreign-fixture-0001', 'quarantine/foreign-fixture-0002']) {
      expect(await deleteOrQueue(t.deps, k, 'account_deletion')).toBe(false);
    }
    expect(t.s3.keys().sort()).toEqual([...FOREIGN].sort());
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get()).toEqual({ n: 0 });
    // A foreign key slipped into the outbox is dropped, not deleted.
    t.db.prepare(`INSERT INTO storage_deletions (object_key, attempts, next_attempt_at, created_at, purpose) VALUES ('evidence/foreign-fixture-0001', 1, 0, 0, 'failed_upload')`).run();
    await sweepStorage(t.deps);
    expect(t.s3.keys().sort()).toEqual([...FOREIGN].sort());
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get()).toEqual({ n: 0 });
  });

  it('records why each retried deletion happens', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    t.s3.failDeletes = true;
    const spoof = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { sizeBytes: PNG.length })).body);
    await put(spoof, PNG);
    await t.req('POST', `/evidence/upload-intents/${spoof.id}/complete`, s.tester.token);
    const ok = UploadIntent.parse((await intentFor(s.tester.token, s.participationId, { clientSegmentId: 'seg-ok' })).body);
    await put(ok, MP4);
    const ev = (await t.req('POST', `/evidence/upload-intents/${ok.id}/complete`, s.tester.token)).body;
    await t.req('POST', `/participations/${s.participationId}/withdraw`, s.tester.token, {});
    await t.req('DELETE', '/me', s.tester.token, { confirm: 'DELETE MY ACCOUNT' });
    // Ordered by purpose: the keys hold random ids, so their order varies between runs.
    expect(t.db.prepare('SELECT object_key, purpose FROM storage_deletions ORDER BY purpose').all()).toEqual([
      { object_key: `evidence/${ev.id}`, purpose: 'account_deletion' },
      { object_key: `quarantine/${spoof.id}`, purpose: 'failed_upload' },
      { object_key: `quarantine/${ok.id}`, purpose: 'upload_staging' },
    ]);
  });

  it('the R2 adapter refuses keys outside evidence/ and quarantine/ before any request', async () => {
    t = await makeApp({ storage: 'r2' });
    plant();
    t.s3.objects.set('pqa-test/foreignbare0003', { body: Buffer.from('x'), contentType: 'text/plain' });
    await expect(t.deps.store.delete('foreignbare0003')).rejects.toThrow(/outside evidence\/ and quarantine\//);
    expect(t.s3.objects.has('pqa-test/foreignbare0003')).toBe(true);
  });

  it('the R2 adapter can only send single-object commands: no listing, batch delete or lifecycle', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/storage/r2.ts'), 'utf8');
    const imported = /import \{([^}]+)\} from '@aws-sdk\/client-s3'/.exec(src)![1]!.split(',').map((x) => x.trim()).sort();
    expect(imported).toEqual(['CopyObjectCommand', 'DeleteObjectCommand', 'GetObjectCommand', 'HeadObjectCommand', 'PutObjectCommand', 'S3Client']);
    expect(src).not.toMatch(/Lifecycle|ListObjects|DeleteObjects|DeleteBucket/);
    // Nor can any other server module (review P3-4).
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
    for (const f of walk(join(import.meta.dirname, '../src'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/Lifecycle|ListObjects|DeleteObjects|DeleteBucket/);
  });

  it('migration 4 registers the objects an existing database already created', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const ok = UploadIntent.parse((await intentFor(s.tester.token, s.participationId)).body);
    await put(ok, MP4);
    const ev = (await t.req('POST', `/evidence/upload-intents/${ok.id}/complete`, s.tester.token)).body;
    const file = t.db.name;
    // Back to the pre-migration-4 schema, then reopen: the backfill must find both keys.
    t.db.exec(`DROP TABLE storage_objects; ALTER TABLE storage_deletions DROP COLUMN purpose; DELETE FROM schema_migrations WHERE version = 4;`);
    const db = openDb(file);
    try {
      expect((db.prepare('SELECT object_key FROM storage_objects ORDER BY object_key').all() as { object_key: string }[]).map((r) => r.object_key)).toEqual([`evidence/${ev.id}`, `quarantine/${ok.id}`]);
      expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: MIGRATION_COUNT - 1 });
    } finally {
      db.close();
    }
  });
});
