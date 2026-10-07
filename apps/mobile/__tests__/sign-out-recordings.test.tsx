import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// Native recordings are deleted from the device ONLY when the tester asks for it: signing out with
// "delete recordings" (Settings asks first and says what goes) or deleting the account. Hamza's
// preserve rule (2026-10-07): a session that ends by itself (a 401, a failed restore, a Firebase
// session that ended) signs out but never costs a recording. Another account on this phone still
// never sees them: a clip is listed only to its own participation's screen.
const mockClearAll = jest.fn(async () => {});
jest.mock('../src/evidence/recorder', () => ({ nativeRecorder: () => ({ clearAllAsync: mockClearAll }) }));
const mockApi = jest.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
const mockConfigure = jest.fn();
const LOCAL = { authMode: 'local', storage: 'local', walletLogin: false, features: { testCredits: false, devnetTransfers: false }, firebase: null };
const mockConfig = jest.fn(async (): Promise<unknown> => LOCAL);
jest.mock('../src/api/client', () => ({
  api: (...a: unknown[]) => mockApi(...a),
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message = code, status = 401) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  configureClient: (o: unknown) => mockConfigure(o),
  getClientConfig: () => mockConfig(),
}));
jest.mock('../src/lib/deployment', () => ({ PRODUCTION_BUILD: false }));
const mockOnIdToken = jest.fn();
jest.mock('../src/auth/firebaseClient', () => ({
  firebaseAuth: jest.fn(() => ({ currentUser: null })),
  firebaseSession: { onIdToken: (...a: unknown[]) => mockOnIdToken(...a), signOut: jest.fn(async () => {}) },
}));
jest.mock('../src/wallet/walletLogin', () => ({ walletLoginFlow: jest.fn() }));
const mockRestore = jest.fn(async (): Promise<string | null> => null);
jest.mock('../src/auth/restore', () => ({ restoreToken: () => mockRestore() }));
const mockTokenClear = jest.fn(async () => {});
jest.mock('../src/auth/tokenStore', () => ({ tokenStore: { get: jest.fn(), set: jest.fn(), clear: () => mockTokenClear() } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SessionProvider, useSession } = require('../src/auth/SessionProvider') as typeof import('../src/auth/SessionProvider');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApiError } = require('../src/api/client') as typeof import('../src/api/client');

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <SessionProvider>{children}</SessionProvider>
  </QueryClientProvider>
);
const ME = { id: 'u1', role: 'tester', displayName: 'T' };

beforeEach(() => {
  mockClearAll.mockClear();
  mockTokenClear.mockClear();
  mockConfigure.mockClear();
  mockApi.mockReset().mockImplementation(async () => ({}));
  mockConfig.mockReset().mockImplementation(async () => LOCAL);
  mockRestore.mockReset().mockImplementation(async () => null);
  mockOnIdToken.mockReset();
});

async function ready() {
  const view = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

it('signing out with "delete recordings" (the Settings confirm) clears every native recording on the device', async () => {
  const { result } = await ready();
  await act(async () => result.current.signOut({ deleteRecordings: true }));
  expect(mockClearAll).toHaveBeenCalledTimes(1);
  expect(mockTokenClear).toHaveBeenCalled();
});

it('a plain sign-out (e.g. "Use another account") ends the session and keeps the recordings', async () => {
  const { result } = await ready();
  await act(async () => result.current.signOut());
  expect(mockTokenClear).toHaveBeenCalled();
  expect(mockClearAll).not.toHaveBeenCalled();
});

it('a 401 signs out but never deletes a recording', async () => {
  mockRestore.mockImplementation(async () => 'tok');
  mockApi.mockImplementation(async () => ME);
  const { result } = await ready();
  expect(result.current.user).toEqual(ME);
  const { onUnauthenticated } = mockConfigure.mock.calls.at(-1)![0] as { onUnauthenticated: () => void };
  await act(async () => {
    onUnauthenticated();
  });
  await waitFor(() => expect(result.current.user).toBeNull());
  expect(mockTokenClear).toHaveBeenCalled();
  expect(mockClearAll).not.toHaveBeenCalled();
});

it('local mode: a saved session the server rejects is cleared, its recordings kept', async () => {
  mockRestore.mockImplementation(async () => 'tok');
  mockApi.mockImplementation(async () => {
    throw new ApiError('UNAUTHENTICATED', 'Sign in again.', 401);
  });
  const { result } = await ready();
  expect(result.current.user).toBeNull();
  expect(mockTokenClear).toHaveBeenCalled();
  expect(mockClearAll).not.toHaveBeenCalled();
});

it('local mode offline start (main-app P2): the saved session and the recordings are both kept, and the app says it can’t connect', async () => {
  mockRestore.mockImplementation(async () => 'tok');
  mockApi.mockImplementation(async () => {
    throw new TypeError('Network request failed');
  });
  const { result } = await ready();
  expect(mockTokenClear).not.toHaveBeenCalled();
  expect(mockClearAll).not.toHaveBeenCalled();
  expect(result.current.unreachable).toBe(true);
});

it('Firebase: a restored session that definitely ended signs out but keeps the recordings', async () => {
  mockConfig.mockImplementation(async () => ({ ...LOCAL, authMode: 'firebase', firebase: { apiKey: 'k', authDomain: 'd', projectId: 'p', appId: 'a', googleSignIn: false } }));
  mockOnIdToken.mockImplementation((_a: unknown, cb: (t: string | null) => void) => {
    cb('id-token');
    return () => {};
  });
  mockApi.mockImplementation(async () => {
    throw new ApiError('UNAUTHENTICATED', 'Sign in again.', 401);
  });
  await ready();
  expect(mockTokenClear).toHaveBeenCalled();
  expect(mockClearAll).not.toHaveBeenCalled();
});

it('discarding an unverified sign-in keeps the recordings', async () => {
  const { result } = await ready();
  await act(async () => result.current.discardUnverified());
  expect(mockClearAll).not.toHaveBeenCalled();
});
