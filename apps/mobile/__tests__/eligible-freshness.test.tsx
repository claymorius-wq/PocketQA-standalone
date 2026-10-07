import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DeviceProfile } from '@pocket-qa/contracts';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import Discover from '../app/(tester)/discover';

// Study ia2ed9db (production trace by the lead): the server lists it to 38/39 Android testers, incl.
// the reporting tester, yet the APK's Discover doesn't show it. Remaining suspects are client-side:
// (i) a stale Discover list: queries don't refetch on window focus, nothing refetches on app
// RESUME (AppState), only on a tab focus; (ii) the ["eligible"] cache isn't user-scoped, so a list
// fetched for one account can be shown to another after an account switch.
// These tests state the DESIRED behaviour; written failing-first, no fix yet. They are `it.failing`
// so the suite stays green while the bug is real: when a fix lands they FAIL, and must be flipped to `it`.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// Tab focus fires once on mount, as on a first visit (useFocusRefetch skips that first call).
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const { useEffect: ue } = jest.requireActual<typeof import('react')>('react');
    ue(() => cb(), [cb]);
  },
}));
const ANDROID: DeviceProfile = { platform: 'android', osVersion: '36', androidApiLevel: 36, model: 'My phone', languages: ['en'] };
let mockUser: { id: string; device: DeviceProfile | null } = { id: 'tester-A', device: ANDROID };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: mockUser, refreshUser: jest.fn() }) }));
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: jest.fn() }));
const { api } = jest.requireMock<{ api: jest.Mock }>('../src/api/client');

const study = (id: string, title: string) => ({ id, title, objective: 'o', rewardCredits: 0, reward: { kind: 'test_credits', credits: 10 }, taskCount: 1, slotsRemaining: 5 });
const eligibleCalls = () => api.mock.calls.filter((c) => c[0] === 'eligibleStudies').length;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const tree = (client: QueryClient) => (
  <QueryClientProvider client={client}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Discover />
      </ThemeProvider>
    </SafeAreaProvider>
  </QueryClientProvider>
);
/** The app's own QueryClient options (app/_layout.tsx): refetchOnWindowFocus false. */
const appClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

let appStateListeners: ((s: AppStateStatus) => void)[] = [];
beforeEach(() => {
  api.mockReset();
  mockUser = { id: 'tester-A', device: ANDROID };
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, l: (s: AppStateStatus) => void) => {
    appStateListeners.push(l);
    return { remove: () => (appStateListeners = appStateListeners.filter((x) => x !== l)) };
  }) as unknown as typeof AppState.addEventListener);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => jest.restoreAllMocks());

describe('Discover freshness (study ia2ed9db investigation)', () => {
  it.failing('(i) coming back to the app (AppState background -> active) refetches the eligible studies', async () => {
    api.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [study('ia2ed9db', 'Android onboarding check')] });
    await render(tree(appClient()));
    await settle();
    expect(eligibleCalls()).toBe(1);
    expect(screen.queryByText('Android onboarding check')).toBeNull();
    // The builder publishes meanwhile; the tester switches back to the app.
    await act(async () => appStateListeners.forEach((l) => l('background')));
    await act(async () => appStateListeners.forEach((l) => l('active')));
    await settle();
    expect(eligibleCalls()).toBe(2);
    expect(screen.getByText('Android onboarding check')).toBeTruthy();
  });

  it.failing('(ii) after an account switch, the previous account’s eligible list is not shown to the new account', async () => {
    const client = appClient();
    // Account A's list is in the cache (fetched while A was signed in).
    client.setQueryData(['eligible'], { items: [study('only-for-A', 'Study only A matches')] });
    // B signs in on the same app without the cache being cleared; B's own list comes from the server.
    mockUser = { id: 'tester-B', device: ANDROID };
    let resolveB: (v: unknown) => void = () => {};
    api.mockImplementation((name: string) => (name === 'eligibleStudies' ? new Promise((r) => (resolveB = r)) : Promise.resolve({})));
    await render(tree(client));
    await settle();
    // While B's list loads, A's must not be on screen as if it were B's.
    expect(screen.queryByText('Study only A matches')).toBeNull();
    await act(async () => resolveB({ items: [study('ia2ed9db', 'Android onboarding check')] }));
    await settle();
    expect(screen.getByText('Android onboarding check')).toBeTruthy();
    expect(screen.queryByText('Study only A matches')).toBeNull();
  });
});
