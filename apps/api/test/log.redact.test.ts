import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, PNG, seeded, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp({ captureLogs: true });
});
afterEach(async () => t.close());

describe('log redaction', () => {
  it('never logs playback tokens, session tokens, passwords or emails', async () => {
    const { tester, participationId } = await seeded(t);
    const ev = (await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'r1' })).body;
    const { token } = (await t.req('POST', `/evidence/${ev.id}/playback-token`, tester.token)).body;
    expect((await t.req('GET', `/media/${token}`)).status).toBe(200);
    // Percent-encoded path variant must be redacted too.
    await t.req('GET', `/%6Dedia/${token}`);
    await t.req('GET', `/media/${token}?download=1`);
    await t.req('POST', '/auth/login', undefined, { email: tester.email, password: 'wrong password here' });

    const all = t.logs.join('\n');
    expect(t.logs.length).toBeGreaterThan(5);
    expect(all).toContain('/media/[redacted]');
    expect(all).not.toContain(token);
    expect(all).not.toContain(tester.token);
    expect(all).not.toContain('correct horse battery staple');
    expect(all).not.toContain('wrong password here');
    expect(all).not.toContain(tester.email);
    expect(all.toLowerCase()).not.toContain('bearer');
  });
});
