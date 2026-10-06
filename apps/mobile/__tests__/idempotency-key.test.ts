import { renderHook } from '@testing-library/react-native';
import { api, configureClient } from '../src/api/client';
import { useIntentKey } from '../src/api/intentKey';

// pqa-qa early r1 P2-H: the client must send an Idempotency-Key on every mutation, keep it across
// its own retry, and use one key per user intent (plan R10/R12).
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// Only the request headers matter here; response parsing is not under test.
const credits = {};
const send = (p: Promise<unknown>) => p.catch(() => undefined);
const KEY = /^[A-Za-z0-9_-]{8,128}$/;

function capture(respond: (auth: string) => Response = () => json(200, credits)) {
  const seen: { method: string; key: string | undefined; auth: string }[] = [];
  global.fetch = jest.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ method: init?.method ?? 'GET', key: h['idempotency-key'], auth: h.authorization ?? '' });
    return respond(h.authorization ?? '');
  }) as unknown as typeof fetch;
  return seen;
}

it('every mutating call carries a valid key; GETs carry none', async () => {
  configureClient({ getToken: () => 'tok', onUnauthenticated: () => {} });
  const seen = capture();
  await send(api('topUp', { body: { amount: 500 } }));
  await send(api('credits'));
  expect(seen[0]!.key).toMatch(KEY);
  expect(seen[1]!.method).toBe('GET');
  expect(seen[1]!.key).toBeUndefined();
});

it('two calls without an intent key are two intents (different keys)', async () => {
  configureClient({ getToken: () => 'tok', onUnauthenticated: () => {} });
  const seen = capture();
  await send(api('topUp', { body: { amount: 500 } }));
  await send(api('topUp', { body: { amount: 500 } }));
  expect(seen[0]!.key).not.toBe(seen[1]!.key);
});

it('the token-refresh retry resends the same key', async () => {
  let token = 'stale';
  configureClient({ getToken: () => token, onUnauthenticated: () => {}, refreshToken: async () => (token = 'fresh') });
  const seen = capture((auth) => (auth === 'Bearer fresh' ? json(200, credits) : json(401, { code: 'UNAUTHENTICATED', message: 'x' })));
  await send(api('topUp', { body: { amount: 500 } }));
  expect(seen.map((s) => s.auth)).toEqual(['Bearer stale', 'Bearer fresh']);
  expect(seen[1]!.key).toBe(seen[0]!.key);
});

it('an explicit intent key is sent as is', async () => {
  configureClient({ getToken: () => 'tok', onUnauthenticated: () => {} });
  const seen = capture();
  await send(api('topUp', { body: { amount: 500 }, idempotencyKey: 'intent-key-0001' }));
  expect(seen[0]!.key).toBe('intent-key-0001');
});

it('useIntentKey: stable across retries of one request, new for a changed request or after done()', async () => {
  const { result, rerender } = await renderHook(() => useIntentKey());
  const first = result.current.keyFor({ amount: 500 });
  expect(first).toMatch(KEY);
  await rerender({});
  expect(result.current.keyFor({ amount: 500 })).toBe(first); // a retry tap
  const changed = result.current.keyFor({ amount: 1000 });
  expect(changed).not.toBe(first); // a different request is a different intent
  result.current.done();
  expect(result.current.keyFor({ amount: 1000 })).not.toBe(changed); // a deliberate second top-up
});
