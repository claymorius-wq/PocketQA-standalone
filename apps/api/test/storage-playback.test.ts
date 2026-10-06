import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYBACK_TOKEN_TTL_SECONDS, PlaybackToken, UploadIntent } from '@pocket-qa/contracts';
import { localStore } from '../src/storage/local';
import { r2Store } from '../src/storage/r2';
import { PRESIGN_GET_MAX_SECONDS } from '../src/storage/types';
import { makeApp, MP4, PNG, seeded, START, type TestApp } from './helpers';

// Plan §6 playback on private R2: after the playback authorisation (owning tester, the study's
// builder, admin), the API returns a presigned GET on the bucket's S3 endpoint (≤ 5 min) instead
// of streaming the bytes (Vercel body limit). Local storage keeps the token + /media stream.
let t: TestApp;
afterEach(async () => t.close());

const CREDS = { accessKeyId: 'test-key-id', secretAccessKey: 'test-secret-key' }; // check-secrets: allow (fake S3 test credentials, as in helpers.ts)

/** Uploads one MP4 through the direct-upload flow; returns the evidence id. */
async function uploaded(s: Awaited<ReturnType<typeof seeded>>) {
  const r = await t.req('POST', `/participations/${s.participationId}/evidence/upload-intents`, s.tester.token, {
    kind: 'screen_recording',
    mimeType: 'video/mp4',
    sizeBytes: MP4.length,
    capturedOn: 'android',
    clientSegmentId: 'seg-1',
  });
  const intent = UploadIntent.parse(r.body);
  expect((await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.headers, body: MP4 })).status).toBe(200);
  const done = await t.req('POST', `/evidence/upload-intents/${intent.id}/complete`, s.tester.token);
  expect(done.status).toBe(200);
  return done.body.id as string;
}

/**
 * Independent SigV4 query-signature check (AWS SigV4 for presigned URLs, UNSIGNED-PAYLOAD), so the
 * test proves the expiry and the response overrides are covered by the signature. The fake S3
 * server itself doesn't verify signatures.
 */
function sigV4Valid(raw: string, secret: string): boolean {
  const u = new URL(raw);
  const q = [...u.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature');
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const canonicalQuery = q
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = u.pathname
    .split('/')
    .map((seg) => enc(decodeURIComponent(seg)))
    .join('/');
  const canonical = ['GET', path, canonicalQuery, `host:${u.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const date = u.searchParams.get('X-Amz-Date')!;
  const scope = u.searchParams.get('X-Amz-Credential')!.split('/').slice(1).join('/');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const [day, region, service] = scope.split('/');
  const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day!), region!), service!), 'aws4_request');
  return createHmac('sha256', key).update(toSign).digest('hex') === u.searchParams.get('X-Amz-Signature');
}

const amzDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

describe('presigned playback (r2)', () => {
  it('the owning tester gets a signed S3-endpoint GET: ≤ 5 min, dated now, served as the sniffed type, inline, not cached', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const id = await uploaded(s);
    const r = await t.req('POST', `/evidence/${id}/playback-token`, s.tester.token);
    expect(r.status).toBe(200);
    const grant = PlaybackToken.parse(r.body);
    expect(grant.token).toBeUndefined();
    const u = new URL(grant.url!);
    // The bucket's own (S3-compatible) endpoint, the final evidence key; no custom domain.
    expect(u.pathname).toBe(`/pqa-test/evidence/${id}`);
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(PLAYBACK_TOKEN_TTL_SECONDS));
    expect(PLAYBACK_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(PRESIGN_GET_MAX_SECONDS);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('response-content-type')).toBe('video/mp4');
    expect(u.searchParams.get('response-content-disposition')).toBe('inline');
    expect(u.searchParams.get('response-cache-control')).toBe('no-store');
    // Signed at the API's clock, so expiresAt is exactly when the URL dies.
    expect(u.searchParams.get('X-Amz-Date')).toBe(amzDate(START));
    expect(grant.expiresAt).toBe(new Date(START + PLAYBACK_TOKEN_TTL_SECONDS * 1000).toISOString());
    expect(sigV4Valid(grant.url!, CREDS.secretAccessKey)).toBe(true);
    // Tampering with any signed part (expiry, response type, key) breaks the signature.
    for (const [k, v] of [['X-Amz-Expires', '604800'], ['response-content-type', 'text/html'], ['response-content-disposition', 'attachment']] as const) {
      const bad = new URL(grant.url!);
      bad.searchParams.set(k, v);
      expect(sigV4Valid(bad.toString(), CREDS.secretAccessKey)).toBe(false);
    }
    const other = new URL(grant.url!);
    other.pathname = '/pqa-test/evidence/someone-else-0001';
    expect(sigV4Valid(other.toString(), CREDS.secretAccessKey)).toBe(false);
    // The bytes come from storage, not from the API.
    expect(Buffer.compare(Buffer.from(await (await fetch(grant.url!)).arrayBuffer()), MP4)).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM playback_tokens').get()).toEqual({ n: 0 });
  });

  it('the study’s builder and an admin are allowed; another tester and another builder get 404', async () => {
    t = await makeApp({ storage: 'r2' });
    const s = await seeded(t);
    const id = await uploaded(s);
    const admin = await t.admin();
    const otherTester = await t.register('tester');
    const otherBuilder = await t.register('builder');
    for (const who of [s.builder, admin]) {
      const r = await t.req('POST', `/evidence/${id}/playback-token`, who.token);
      expect(r.status).toBe(200);
      expect(r.body.url).toContain(`/evidence/${id}?`);
    }
    for (const who of [otherTester, otherBuilder]) {
      const r = await t.req('POST', `/evidence/${id}/playback-token`, who.token);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('X-Amz');
    }
    expect((await t.req('POST', `/evidence/${id}/playback-token`)).status).toBe(401);
  });

  it('presignGet refuses keys outside evidence/ and quarantine/ and TTLs above 5 minutes', async () => {
    const store = r2Store({ accountId: '0'.repeat(32), bucket: 'pqa-test', endpoint: 'http://127.0.0.1:9', ...CREDS, allowDelete: false });
    const opts = { contentType: 'video/mp4', expiresInSeconds: 300, signingDate: new Date(START) };
    await expect(store.presignGet('retained-local-submissions/4aef8a84.mp4', opts)).rejects.toThrow();
    await expect(store.presignGet('plainkey-0001', opts)).rejects.toThrow('outside evidence/ and quarantine/');
    await expect(store.presignGet('evidence/abcdefgh', { ...opts, expiresInSeconds: 301 })).rejects.toThrow('1..300');
    await expect(store.presignGet('evidence/abcdefgh', { ...opts, expiresInSeconds: 0 })).rejects.toThrow('1..300');
    expect((await store.presignGet('evidence/abcdefgh', opts)).url).toContain('/pqa-test/evidence/abcdefgh?');
  });
});

describe('local storage playback (unchanged)', () => {
  it('still a token for /media, streamed by the API', async () => {
    t = await makeApp();
    const s = await seeded(t);
    const up = await t.upload(s.tester.token, s.participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'shot-1' });
    expect(up.status).toBe(200);
    const grant = PlaybackToken.parse((await t.req('POST', `/evidence/${up.body.id}/playback-token`, s.builder.token)).body);
    expect(grant.url).toBeUndefined();
    const media = await t.req('GET', `/media/${grant.token}`);
    expect(media.status).toBe(200);
    expect(Buffer.compare(media.raw, PNG)).toBe(0);
    await expect(localStore('/nonexistent').presignGet('evidence/abcdefgh', { contentType: 'image/png', expiresInSeconds: 60, signingDate: new Date(START) })).rejects.toThrow('streams through /media');
  });
});
