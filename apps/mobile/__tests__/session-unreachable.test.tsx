import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// inc4 review P3-2: a production build that can't read /config says so and can retry; it
// never assumes local accounts. A development build keeps its old behaviour.
const mockConfig = jest.fn();
let mockProduction = true;
jest.mock('../src/api/client', () => ({
  api: jest.fn(async () => {
    throw new Error('no api in this test');
  }),
  ApiError: class extends Error {},
  configureClient: jest.fn(),
  getClientConfig: () => mockConfig(),
}));
jest.mock('../src/lib/deployment', () => ({
  get PRODUCTION_BUILD() {
    return mockProduction;
  },
}));
jest.mock('../src/auth/firebaseClient', () => ({ firebaseAuth: jest.fn(), firebaseSession: {} }));
jest.mock('../src/wallet/walletLogin', () => ({ walletLoginFlow: jest.fn() }));
jest.mock('../src/auth/restore', () => ({ restoreToken: jest.fn(async () => null) }));
jest.mock('../src/auth/tokenStore', () => ({ tokenStore: { get: jest.fn(), set: jest.fn(), clear: jest.fn(async () => {}) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SessionProvider, useSession } = require('../src/auth/SessionProvider') as typeof import('../src/auth/SessionProvider');

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <SessionProvider>{children}</SessionProvider>
  </QueryClientProvider>
);
const local = { authMode: 'local', storage: 'local', walletLogin: false, features: { testCredits: false, devnetTransfers: false }, firebase: null };

beforeEach(() => mockConfig.mockReset());

it('production: an unreadable /config is reported as unreachable, and retry recovers', async () => {
  mockProduction = true;
  mockConfig.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(local);
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.unreachable).toBe(true);
  await act(async () => result.current.retryConnection());
  await waitFor(() => expect(result.current.unreachable).toBe(false));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(mockConfig).toHaveBeenCalledTimes(2);
});

it('development: an unreadable /config keeps the old local-mode behaviour (not unreachable)', async () => {
  mockProduction = false;
  mockConfig.mockRejectedValueOnce(new Error('offline'));
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.unreachable).toBe(false);
  expect(result.current.authMode).toBe('local');
});
