import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { SettingsScreen } from '../SettingsScreen';

// Settings in the Lens (A-Settings): per-role sections, the board's card order and the states the
// screen owns (device grid, saved / failed, wallet branches, delete sheet). Data and copy unchanged.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../api/client', () => ({ ...jest.requireActual('../../api/client'), api: jest.fn() }));
jest.mock('../../lib/queries', () => ({ useAiStatus: () => ({ data: { available: false } }) }));
jest.mock('../../wallet/link', () => ({ linkWalletWithMwa: jest.fn() }));

type Role = 'tester' | 'builder' | 'admin';
const mockSession = {
  user: null as null | Record<string, unknown>,
  signOut: jest.fn(() => Promise.resolve()),
  refreshUser: jest.fn(() => Promise.resolve()),
};
jest.mock('../../auth/SessionProvider', () => ({ useSession: () => mockSession }));

const { api } = jest.requireMock<{ api: jest.Mock }>('../../api/client');

function userFor(role: Role, wallet?: { address: string }) {
  return {
    id: 'u1',
    email: `${role}@example.test`,
    displayName: role === 'admin' ? 'Admin' : role === 'builder' ? 'Demo Builder' : 'Demo Tester',
    role,
    device: role === 'tester' ? { platform: 'web', osVersion: 'preview', androidApiLevel: null, model: 'Browser', languages: ['en'] } : null,
    wallet: wallet ?? null,
  };
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
  api.mockReset();
  mockSession.signOut.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Lets the mutation resolve and react-query's batched notifications (timers) reach the screen. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20);
    });
  }
}

async function renderSettings(role: Role, scheme: ThemePreference = 'dark', wallet?: { address: string }) {
  mockSession.user = userFor(role, wallet);
  let setPreference: ((p: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const result = await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">
          <Scheme>
            <SettingsScreen />
          </Scheme>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await act(async () => setPreference?.(scheme));
  return result;
}

describe.each<ThemePreference>(['dark', 'light'])('SettingsScreen in %s', (scheme) => {
  it('tester: Appearance, Matching, Wallet, AI analysis, Account and Sign out, in the board order', async () => {
    await renderSettings('tester', scheme);
    expect(screen.getByTestId('settings-screen')).toBeTruthy();
    expect(screen.getByText('Demo Tester · tester')).toBeTruthy();
    const headings = ['Appearance', 'Matching', 'Wallet', 'AI analysis', 'Account'];
    for (const h of headings) expect(screen.getByText(h).props.accessibilityRole).toBe('header');
    for (const id of ['theme', 'device-form', 'device-platform', 'device-os', 'device-model', 'device-languages', 'device-save', 'wallet-section', 'ai-status', 'export-data', 'delete-account', 'sign-out']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    // Card titles sit in the board's header rows; the AI readout stays unlit (no card).
    for (const t of ['Device profile', 'Devnet wallet', 'Your data', 'Analysis provider']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText('UNAVAILABLE')).toBeTruthy();
    // jest-expo runs as iOS: the wallet explains MWA is Android-only and offers no link.
    expect(screen.getByTestId('wallet-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('wallet-link')).toBeNull();
    expect(screen.getByText('NOT LINKED')).toBeTruthy();
  });

  it('builder has no Matching', async () => {
    await renderSettings('builder', scheme);
    expect(screen.queryByTestId('device-form')).toBeNull();
    expect(screen.getByTestId('wallet-section')).toBeTruthy();
    expect(screen.getByText('Demo Builder · builder')).toBeTruthy();
  });

  it('admin has neither Matching nor Wallet', async () => {
    await renderSettings('admin', scheme);
    expect(screen.queryByTestId('device-form')).toBeNull();
    expect(screen.queryByTestId('wallet-section')).toBeNull();
    expect(screen.getByTestId('ai-status')).toBeTruthy();
    expect(screen.getByTestId('sign-out')).toBeTruthy();
  });
});

describe('SettingsScreen states', () => {
  it('Android adds the API level field beside OS version; other platforms drop it', async () => {
    await renderSettings('tester');
    expect(screen.queryByTestId('device-api')).toBeNull();
    await fireEvent.press(screen.getByTestId('device-platform-android'));
    expect(screen.getByTestId('device-api')).toBeTruthy();
    expect(screen.getByText('Android 14 is API 34.')).toBeTruthy();
    expect(screen.getByTestId('device-model')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('device-platform-ios'));
    expect(screen.queryByTestId('device-api')).toBeNull();
    expect(screen.getByTestId('device-model')).toBeTruthy();
  });

  it('saving the device profile sends the same body and shows "Device profile saved"', async () => {
    api.mockResolvedValue({});
    await renderSettings('tester');
    await fireEvent.press(screen.getByTestId('device-save'));
    await settle();
    expect(api).toHaveBeenCalledWith('putDevice', { body: { platform: 'web', osVersion: 'preview', androidApiLevel: null, model: 'Browser', languages: ['en'] } });
    expect(screen.getByTestId('device-saved')).toBeTruthy();
    expect(mockSession.refreshUser).toHaveBeenCalled();
  });

  it('a failed save shows "Couldn’t save" with the server message', async () => {
    api.mockRejectedValue(new ApiError('OFFLINE', 'Can’t reach the Pocket QA server.', 0));
    await renderSettings('tester');
    await fireEvent.press(screen.getByTestId('device-save'));
    await settle();
    expect(screen.getByText('Couldn’t save')).toBeTruthy();
    expect(screen.getByText('Can’t reach the Pocket QA server.')).toBeTruthy();
    expect(screen.queryByTestId('device-saved')).toBeNull();
  });

  it('export shows "Export ready" with the bundle counts', async () => {
    api.mockResolvedValue({
      participations: [{}],
      studies: [],
      evidence: [],
      ledger: [],
      payments: { received: [{}], fundings: [], refunds: [], studyPayments: [] },
      reputation: { events: [{}, {}] },
    });
    await renderSettings('tester');
    await fireEvent.press(screen.getByTestId('export-data'));
    await settle();
    expect(api).toHaveBeenCalledWith('exportMe');
    expect(screen.getByTestId('export-done')).toBeTruthy();
    expect(screen.getByText('1 participations, 0 studies, 0 evidence items, 0 ledger entries, 1 wallet escrow records (simulated), 2 reputation events.')).toBeTruthy();
  });

  it('a linked wallet shows the address and Unlink, with the Linked pill', async () => {
    await renderSettings('tester', 'dark', { address: 'FbRTEBqbGGsVhZCQWBFAgUnYcSFxyRCXbtxArHAgphAr' });
    expect(screen.getByTestId('wallet-address').props.children).toBe('FbRTEBqbGGsVhZCQWBFAgUnYcSFxyRCXbtxArHAgphAr');
    expect(screen.getByTestId('wallet-unlink')).toBeTruthy();
    expect(screen.queryByTestId('wallet-unavailable')).toBeNull();
    expect(screen.getByText('LINKED')).toBeTruthy();
  });

  it('delete: the confirm waits for the phrase; a refusal shows "Couldn’t delete" in the sheet', async () => {
    api.mockRejectedValue(new ApiError('CONFLICT_STATE', 'Wait until your submitted work is reviewed and disputes are resolved.', 409));
    await renderSettings('tester');
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('delete-account'));
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
    expect(screen.getByText('Delete your account?')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('delete-phrase'), 'delete');
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('delete-phrase'), 'DELETE MY ACCOUNT');
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await settle();
    expect(api).toHaveBeenCalledWith('deleteMe', { body: { confirm: 'DELETE MY ACCOUNT' } });
    expect(screen.getByText('Couldn’t delete')).toBeTruthy();
    expect(screen.getByText('Wait until your submitted work is reviewed and disputes are resolved.')).toBeTruthy();
    expect(mockSession.signOut).not.toHaveBeenCalled();
  });

  it('Sign out signs out directly (no sheet)', async () => {
    await renderSettings('builder');
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(mockSession.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
  });
});
