import { api, configureClient } from '../src/api/client';

// Increment-4 review r1 P3: an expired ID token is refreshed once before signing out.
const user = { id: 'u1', email: 'a@example.test', displayName: 'A', role: 'tester', status: 'active', device: null, wallet: null, createdAt: '2026-10-04T00:00:00.000Z' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('on 401, refreshes the token and retries once; signs out only if that fails too', async () => {
  const seen: string[] = [];
  global.fetch = jest.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string>).authorization ?? '';
    seen.push(auth);
    return auth === 'Bearer fresh' ? json(200, user) : json(401, { code: 'UNAUTHENTICATED', message: 'x' });
  }) as unknown as typeof fetch;
  let token = 'stale';
  const signedOut = jest.fn();
  configureClient({ getToken: () => token, onUnauthenticated: signedOut, refreshToken: async () => (token = 'fresh') });
  expect((await api('me')).id).toBe('u1');
  expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
  expect(signedOut).not.toHaveBeenCalled();

  token = 'revoked';
  configureClient({ getToken: () => token, onUnauthenticated: signedOut, refreshToken: async () => (token = 'still-bad') });
  await expect(api('me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(signedOut).toHaveBeenCalledTimes(1);
});

it('without a refresher (local mode), a 401 signs out at once as before', async () => {
  global.fetch = jest.fn(async () => json(401, { code: 'UNAUTHENTICATED', message: 'x' })) as unknown as typeof fetch;
  const signedOut = jest.fn();
  configureClient({ getToken: () => 'tok', onUnauthenticated: signedOut });
  await expect(api('me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(signedOut).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
});
