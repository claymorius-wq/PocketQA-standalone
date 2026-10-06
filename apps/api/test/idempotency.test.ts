import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers';

// Idempotency-Key on mutating routes (docs/plans/firebase-vercel-refactor.md R10): a retry with the
// same key and request replays the first response; the same key with another request is 422; keys
// are scoped per user and route; a failed request can be retried.
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

const key = (h: string) => ({ 'idempotency-key': h });

describe('Idempotency-Key', () => {
  it('a retried top-up with the same key runs once and replays the first response', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    const first = await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 }, key('topup-key-0001'));
    const again = await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 }, key('topup-key-0001'));
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const credits = await t.req('GET', '/me/credits', b.token);
    expect(credits.body.balance).toBe(first.body.balance); // credited once
  });

  it('the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED, and nothing runs', async () => {
    t = await makeApp();
    const b = await t.req('POST', '/auth/register', undefined, { email: 'b1@example.test', password: 'correct horse battery staple', displayName: 'B', role: 'builder' });
    const token = b.body.token as string;
    await t.req('POST', '/me/credits/test-topup', token, { amount: 100 }, key('topup-key-0002'));
    const reused = await t.req('POST', '/me/credits/test-topup', token, { amount: 200 }, key('topup-key-0002'));
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const credits = await t.req('GET', '/me/credits', token);
    expect(credits.body.entries.filter((e: { kind: string }) => e.kind === 'topup' || e.kind === 'test_topup')).toHaveLength(1);
  });

  it('keys are scoped per user: another user with the same key runs their own request', async () => {
    t = await makeApp();
    const a = await t.register('builder');
    const c = await t.register('builder');
    await t.req('POST', '/me/credits/test-topup', a.token, { amount: 100 }, key('shared-key-0003'));
    const other = await t.req('POST', '/me/credits/test-topup', c.token, { amount: 100 }, key('shared-key-0003'));
    expect(other.status).toBe(200);
    expect((await t.req('GET', '/me/credits', c.token)).body.balance).toBe(other.body.balance);
  });

  it('a malformed key is a 400; a request that failed can be retried with the same key', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    expect((await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 }, key('bad key!'))).status).toBe(400);
    // A study that doesn't exist: the handler fails, the reservation is dropped.
    const failed = await t.req('POST', '/studies/does-not-exist/publish', b.token, undefined, key('publish-key-0004'));
    expect(failed.status).toBe(404);
    const retried = await t.req('POST', '/studies/does-not-exist/publish', b.token, undefined, key('publish-key-0004'));
    expect(retried.status).toBe(404); // ran again (not a stored replay of a failure)
  });

  it('GET requests and requests without a key are unaffected', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 });
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 });
    const credits = await t.req('GET', '/me/credits', b.token, undefined, key('get-key-00005'));
    expect(credits.status).toBe(200);
    expect(credits.body.entries.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Idempotency-Key from the web client (pqa-qa early r1 P2-H)', () => {
  it('a browser preflight allows the idempotency-key header', async () => {
    t = await makeApp();
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/me/credits/test-topup',
      headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,idempotency-key' },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(String(res.headers['access-control-allow-headers'])).toContain('idempotency-key');
  });

  it('without a key two identical top-ups are two intents; a retry with the key is one effect', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 });
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 });
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 }, key('retry-key-0006'));
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 }, key('retry-key-0006'));
    const entries = (await t.req('GET', '/me/credits', b.token)).body.entries.filter((e: { kind: string }) => e.kind === 'topup' || e.kind === 'test_topup');
    expect(entries).toHaveLength(3);
  });
});
