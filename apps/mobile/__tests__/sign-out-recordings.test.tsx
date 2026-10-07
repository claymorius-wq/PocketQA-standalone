import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// Native recordings never outlive the account that made them (pqa-qa r1 guardrail 1): signing out,
// and deleting the account (which signs out), stops any recording and deletes every pending clip
// and notice on the device, so the next account on this phone sees none of them.
const mockClearAll = jest.fn(async () => {});
jest.mock('../src/evidence/recorder', () => ({ nativeRecorder: () => ({ clearAllAsync: mockClearAll }) }));
jest.mock('../src/api/client', () => ({
  api: jest.fn(async () => ({})),
  ApiError: class extends Error {},
  configureClient: jest.fn(),
  getClientConfig: async () => ({ authMode: 'local', storage: 'local', walletLogin: false, features: { testCredits: false, devnetTransfers: false }, firebase: null }),
}));
jest.mock('../src/lib/deployment', () => ({ PRODUCTION_BUILD: false }));
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

it('signing out clears every native recording on the device', async () => {
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  mockClearAll.mockClear();
  await act(async () => result.current.signOut());
  expect(mockClearAll).toHaveBeenCalledTimes(1);
});
