import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { MAX_EVIDENCE_ITEMS_PER_PARTICIPATION, PLAYBACK_TOKEN_TTL_SECONDS } from '@pocket-qa/contracts';
import { makeApp, MP4, PNG, seeded, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => t.close());

describe('evidence upload', () => {
  it('decides content type by file signature and rejects mismatches', async () => {
    const { tester, participationId } = await seeded(t);
    const ok = await t.upload(tester.token, participationId, MP4, { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'v1', durationMs: 4000 });
    expect(ok.status).toBe(200);
    expect(ok.body.mimeType).toBe('video/mp4');
    const wrongKind = await t.upload(tester.token, participationId, MP4, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'v2' });
    expect(wrongKind.status).toBe(400);
    const html = await t.upload(tester.token, participationId, Buffer.from('<html><script>alert(1)</script></html>'), { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'v3' });
    expect(html.status).toBe(400);
    // Rejected uploads leave no file behind.
    expect(readdirSync(t.mediaDir)).toHaveLength(1);
  });

  it('rejects duplicate segments, bad metadata and too many items', async () => {
    const { tester, participationId } = await seeded(t);
    expect((await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'd1' })).status).toBe(200);
    expect((await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'd1' })).status).toBe(409);
    expect((await t.upload(tester.token, participationId, PNG, { kind: 'nope' })).status).toBe(400);
    for (let i = 2; i <= MAX_EVIDENCE_ITEMS_PER_PARTICIPATION; i++) {
      await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: `d${i}` });
    }
    const over = await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'd999' });
    expect(over.status).toBe(409);
  });

  it('refuses evidence before the tester starts', async () => {
    const { study } = await seeded(t);
    const t2 = await t.register('tester');
    await t.req('PUT', '/me/device', t2.token, { platform: 'web', osVersion: 'x', androidApiLevel: null, model: 'x', languages: ['en'] });
    const p = (await t.req('POST', `/studies/${study.id}/consent`, t2.token, { consentVersion: 1, accepted: true })).body;
    expect((await t.upload(t2.token, p.id, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'a' })).status).toBe(409);
  });
});

describe('playback tokens and media', () => {
  it('streams to the token holder, supports ranges, and expires', async () => {
    const { builder, tester, participationId } = await seeded(t);
    const ev = (await t.upload(tester.token, participationId, MP4, { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'v1' })).body;
    const { token, expiresAt } = (await t.req('POST', `/evidence/${ev.id}/playback-token`, builder.token)).body;
    expect(Date.parse(expiresAt) - t.clock.now).toBe(PLAYBACK_TOKEN_TTL_SECONDS * 1000);

    const full = await t.req('GET', `/media/${token}`);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['cache-control']).toBe('no-store');
    expect(full.raw.equals(MP4)).toBe(true);

    const part = await t.req('GET', `/media/${token}`, undefined, undefined, { range: 'bytes=4-11' });
    expect(part.status).toBe(206);
    expect(part.raw.toString('latin1')).toBe('ftypmp42');

    t.clock.now += PLAYBACK_TOKEN_TTL_SECONDS * 1000;
    expect((await t.req('GET', `/media/${token}`)).status).toBe(404);
  });

  it('a token works only for its own evidence, and stops working when access is lost', async () => {
    const { tester, participationId } = await seeded(t);
    const ev = (await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'p1' })).body;
    const { token } = (await t.req('POST', `/evidence/${ev.id}/playback-token`, tester.token)).body;
    expect((await t.req('GET', `/media/${token}x`)).status).toBe(404);
    expect((await t.req('GET', `/media/not-a-token`)).status).toBe(404);
    t.db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(tester.id);
    expect((await t.req('GET', `/media/${token}`)).status).toBe(404);
  });

  it('a stranger cannot mint a token for someone else’s evidence', async () => {
    const { tester, participationId } = await seeded(t);
    const ev = (await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'p1' })).body;
    const stranger = await t.register('builder');
    const r = await t.req('POST', `/evidence/${ev.id}/playback-token`, stranger.token);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ code: 'NOT_FOUND', message: 'Evidence not found.' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM playback_tokens').get()).toEqual({ n: 0 });
  });
});
