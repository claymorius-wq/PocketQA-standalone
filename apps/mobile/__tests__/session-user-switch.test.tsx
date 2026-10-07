import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// Study ia2ed9db follow-up: any change of signed-in user clears the query cache, not only signOut,
// so one account's lists (e.g. its eligible studies) are never shown to another account.
const mockConfig = jest.fn();
jest.mock('../src/api/client', () => ({
  api: jest.fn(async () => {
    throw new Error('no api in this test');
  }),
  ApiError: class extends Error {},
  configureClient: jest.fn(),
  getClientConfig: () => mockConfig(),
}));
jest.mock('../src/lib/deployment', () => ({ PRODUCTION_BUILD: false }));
jest.mock('../src/auth/firebaseClient', () => ({ firebaseAuth: jest.fn(), firebaseSession: {} }));
jest.mock('../src/wallet/walletLogin', () => ({ walletLoginFlow: jest.fn() }));
jest.mock('../src/auth/restore', () => ({ restoreToken: jest.fn(async () => null) }));
jest.mock('../src/auth/tokenStore', () => ({ tokenStore: { get: jest.fn(), set: jest.fn(async () => {}), clear: jest.fn(async () => {}) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SessionProvider, useSession } = require('../src/auth/SessionProvider') as typeof import('../src/auth/SessionProvider');
const { api } = jest.requireMock<{ api: jest.Mock }>('../src/api/client');
/** Local sign-in (the public path into accept()): POST /auth/login answers with this user. */
const signInAs = async (s: { signIn: (e: string, p: string) => Promise<unknown> }, id: string) => {
  api.mockImplementationOnce(async () => ({ token: `t-${id}`, user: user(id) }));
  await s.signIn(`${id}@example.test`, 'correct horse battery staple');
};

const local = { authMode: 'local', storage: 'local', walletLogin: false, features: { testCredits: false, devnetTransfers: false }, firebase: null };
const user = (id: string) => ({ id, email: `${id}@example.test`, displayName: id, role: 'tester', device: null, wallet: null }) as never;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <SessionProvider>{children}</SessionProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  mockConfig.mockReset();
  mockConfig.mockResolvedValue(local);
  client = new QueryClient();
});

it('signing in as ANOTHER user (without signing out) clears the cache (A’s eligible list is gone for B)', async () => {
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => signInAs(result.current, 'tester-A'));
  client.setQueryData(['eligible', 'tester-A'], { items: [{ id: 'only-for-A' }] });
  await act(async () => signInAs(result.current, 'tester-B'));
  expect(result.current.user?.id).toBe('tester-B');
  expect(client.getQueryData(['eligible', 'tester-A'])).toBeUndefined();
});

it('signing in as the SAME user again keeps the cache (a refreshed token is not a switch)', async () => {
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => signInAs(result.current, 'tester-A'));
  client.setQueryData(['eligible', 'tester-A'], { items: [{ id: 's1' }] });
  await act(async () => signInAs(result.current, 'tester-A'));
  expect(client.getQueryData(['eligible', 'tester-A'])).toEqual({ items: [{ id: 's1' }] });
});
