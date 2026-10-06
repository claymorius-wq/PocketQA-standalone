import { afterEach, describe, expect, it } from 'vitest';
import { UploadIntent } from '@pocket-qa/contracts';
import { makeApp, MP4, PNG, seeded, type TestApp } from './helpers';

// Plan R12 rows for evidence (pqa-qa early r1 P2-F): a mutation whose effect committed but whose
// response was lost (crash, timeout, failed idempotency completion) is retried. It must return the
// same evidence, or a clean 409, and never add a second evidence row.
let t: TestApp;
afterEach(async () => t.close());

/** Simulates a crash after commit: the idempotency completion write fails once. */
function failNextCompletion(app: TestApp) {
  const core = app.deps.repo.core;
  const real = core.completeIdempotency.bind(core);
  let armed = true;
  core.completeIdempotency = async (...args) => {
    if (armed) {
      armed = false;
      throw new Error('simulated crash after commit');
    }
    return real(...args);
  };
}

const evidenceRows = () => (t.db.prepare('SELECT COUNT(*) AS n FROM evidence').get() as { n: number }).n;
const key = (k: string) => ({ 'idempotency-key': k });

/** The multipart upload (as helpers.ts builds it), with extra headers. */
function upload(token: string, participationId: string, file: Buffer, meta: Record<string, unknown>, headers: Record<string, string> = {}) {
  const boundary = '----pqa' + Math.random().toString(16).slice(2);
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return t.req('POST', `/participations/${participationId}/evidence`, token, payload, { 'content-type': `multipart/form-data; boundary=${boundary}`, ...headers });
}

describe('uploadEvidence (local storage): evidence id from the Idempotency-Key', () => {
  it('a retry after a committed upload returns the same evidence; one row', async () => {
    t = await makeApp();
    const s = await seeded(t);
    failNextCompletion(t);
    const meta = { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'shot-1' };
    const first = await upload(s.tester.token, s.participationId, PNG, meta, key('upload-key-0001'));
    expect(first.status).toBe(500);
    expect(evidenceRows()).toBe(1); // the effect committed
    const retry = await upload(s.tester.token, s.participationId, PNG, meta, key('upload-key-0001'));
    expect(retry.status).toBe(200);
    expect(evidenceRows()).toBe(1);
    const list = await t.req('GET', `/participations/${s.participationId}/evidence`, s.tester.token);
    expect(list.body.items.map((e: { id: string }) => e.id)).toEqual([retry.body.id]);
    // Completed now: a further retry replays the stored response.
    const replay = await upload(s.tester.token, s.participationId, PNG, meta, key('upload-key-0001'));
    expect(replay.body.id).toBe(retry.body.id);
    expect(evidenceRows()).toBe(1);
  });

  it('the same key reused for a different segment after a crash is a clean 409', async () => {
    t = await makeApp();
    const s = await seeded(t);
    failNextCompletion(t);
    expect((await upload(s.tester.token, s.participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'a' }, key('upload-key-0002'))).status).toBe(500);
    const other = await upload(s.tester.token, s.participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'b' }, key('upload-key-0002'));
    expect(other.status).toBe(409);
    expect(evidenceRows()).toBe(1);
  });

  it('without a key every upload gets a fresh id', async () => {
    t = await makeApp();
    const s = await seeded(t);
    const a = await upload(s.tester.token, s.participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'a' });
    const b = await upload(s.tester.token, s.participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'b' });
    expect(a.body.id).not.toBe(b.body.id);
    expect(evidenceRows()).toBe(2);
  });
});

describe('completeUploadIntent (r2): a retry after a committed completion', () => {
  async function arrived(s: Awaited<ReturnType<typeof seeded>>) {
    const r = await t.req('POST', `/participations/${s.participationId}/evidence/upload-intents`, s.tester.token, {
      kind: 'screen_recording',
      mimeType: 'video/mp4',
      sizeBytes: MP4.length,
      capturedOn: 'android',
      clientSegmentId: 'seg-1',
    });
    const intent = UploadIntent.parse(r.body);
    expect((await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.headers, body: MP4 })).status).toBe(200);
    return intent;
  }

  it('with the same key: the same evidence, one row', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = await arrived(s);
    failNextCompletion(t);
    const first = await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token, undefined, key('complete-key-01'));
    expect(first.status).toBe(500);
    expect(evidenceRows()).toBe(1);
    const retry = await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token, undefined, key('complete-key-01'));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ mimeType: 'video/mp4', sizeBytes: MP4.length });
    expect(evidenceRows()).toBe(1);
    expect(t.s3.keys().filter((k) => k.startsWith('pqa-test/evidence/'))).toEqual([`pqa-test/evidence/${retry.body.id}`]);
  });

  it('without a key (or another key): the same evidence, one row', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = await arrived(s);
    const first = await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token);
    expect(first.status).toBe(200);
    for (const h of [undefined, key('another-key-01')]) {
      const again = await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token, undefined, h);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
    }
    expect(evidenceRows()).toBe(1);
  });

  it('another tester still gets 404', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const i = await arrived(s);
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, s.tester.token)).status).toBe(200);
    const other = await t.register('tester');
    expect((await t.req('POST', `/evidence/upload-intents/${i.id}/complete`, other.token)).status).toBe(404);
  });
});
