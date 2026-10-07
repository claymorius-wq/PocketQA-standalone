import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DeviceProfile } from '@pocket-qa/contracts';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import Discover from '../app/(tester)/discover';

// Discover in the Lens system (A-Discover): the header lens beside a list only, the matched
// device line, the study cards, the empty and failed states, and the re-entry on a new result.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (path: string) => mockPush(path) } }));

let mockUser: { device: DeviceProfile | null } | null = null;
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: mockUser }) }));

type Item = { id: string; title: string; objective: string; rewardCredits: number; reward: { kind: 'test_credits'; credits: number }; taskCount: number; slotsRemaining: number };
type Query = { isLoading: boolean; error: unknown; data: { items: Item[] } | undefined; refetch: jest.Mock };
let mockQuery: Query;
jest.mock('../src/lib/queries', () => ({ useEligible: () => mockQuery, useFocusRefetch: () => undefined }));

const WEB_DEVICE: DeviceProfile = { platform: 'web', osVersion: 'Browser', androidApiLevel: null, model: 'Web preview', languages: ['en'] };
const STUDIES: Item[] = [
  { id: 'a', title: 'Demo: onboarding screens', objective: 'Find where first-time users hesitate during sign-up.', rewardCredits: 30, reward: { kind: 'test_credits', credits: 30 }, taskCount: 1, slotsRemaining: 5 },
  { id: 'b', title: 'Checkout flow', objective: 'Watch the payment step.', rewardCredits: 50, reward: { kind: 'test_credits', credits: 50 }, taskCount: 3, slotsRemaining: 1 },
];
/** The lens is decorative (hidden from assistive tech), so queries must include hidden elements. */
const HIDDEN_OK = { includeHiddenElements: true };
const loaded = (items: Item[]): Query => ({ isLoading: false, error: null, data: { items }, refetch: jest.fn() });

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
let setPreference: ((p: ThemePreference) => void) | undefined;
function Scheme({ children }: { children: ReactNode }) {
  setPreference = useTheme().setPreference;
  return <>{children}</>;
}
// The app always provides a QueryClient (Discover's "Use this phone's details" is a mutation).
const tree = () => (
  <QueryClientProvider client={new QueryClient()}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Scheme>
          <Discover />
        </Scheme>
      </ThemeProvider>
    </SafeAreaProvider>
  </QueryClientProvider>
);
async function renderIn(scheme: ThemePreference) {
  const r = await render(tree());
  await act(async () => setPreference?.(scheme));
  return r;
}
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe.each<ThemePreference>(['dark', 'light'])('Discover in %s', (scheme) => {
  it('lists matched studies under the header lens, with the device line and the footer', async () => {
    mockUser = { device: WEB_DEVICE };
    mockQuery = loaded(STUDIES);
    await renderIn(scheme);
    expect(screen.getByTestId('discover-screen')).toBeTruthy();
    expect(screen.getByTestId('discover-lens', HIDDEN_OK)).toBeTruthy();
    expect(screen.queryByTestId('device-missing')).toBeNull();
    expect(screen.getByText('OPEN STUDIES · 2')).toBeTruthy();

    // The device line reads as one phrase; Edit (announced as "Edit device profile") opens Settings.
    expect(screen.getByLabelText('Matched to Web, Browser')).toBeTruthy();
    expect(screen.getByTestId('device-edit').props.accessibilityLabel).toBe('Edit device profile');
    await fireEvent.press(screen.getByTestId('device-edit'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings');

    const card = screen.getByTestId('study-card-a');
    expect(card.props.accessibilityLabel).toBe('Open study Demo: onboarding screens');
    expect(card.props.accessibilityHint).toMatch(/^30 test credits\. Reward if approved\. Not guaranteed\./);
    expect(screen.getByText('5 slots left')).toBeTruthy();
    expect(screen.getByText('1 slot left')).toBeTruthy();
    expect(screen.getAllByText(/Reward if approved/)).toHaveLength(2);
    await fireEvent.press(card);
    expect(mockPush).toHaveBeenLastCalledWith('/study/a');
    expect(screen.getByText('New studies appear here when they match your device.')).toBeTruthy();
  });

  it('without a device profile: the warning notice and the empty panel with Open settings, no header lens', async () => {
    mockUser = { device: null };
    mockQuery = loaded([]);
    await renderIn(scheme);
    expect(screen.getByTestId('device-missing')).toBeTruthy();
    expect(screen.getByText('Add your device profile')).toBeTruthy();
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No device profile yet')).toBeTruthy();
    expect(screen.queryByTestId('discover-lens', HIDDEN_OK)).toBeNull();
    expect(screen.queryByTestId('device-matched')).toBeNull();
    await fireEvent.press(screen.getByTestId('open-settings'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings');
  });

  it('with a device and nothing matching: the device line and the empty panel, no action, no header lens', async () => {
    mockUser = { device: WEB_DEVICE };
    mockQuery = loaded([]);
    await renderIn(scheme);
    expect(screen.getByTestId('device-matched')).toBeTruthy();
    expect(screen.getByText('No matching studies right now')).toBeTruthy();
    expect(screen.queryByTestId('open-settings')).toBeNull();
    expect(screen.queryByTestId('discover-lens', HIDDEN_OK)).toBeNull();
    expect(screen.queryByText(/OPEN STUDIES/)).toBeNull();
  });

  it('a failed load shows the error panel with Retry and no header lens', async () => {
    mockUser = { device: WEB_DEVICE };
    mockQuery = { isLoading: false, error: new Error('boom'), data: { items: STUDIES }, refetch: jest.fn() };
    await renderIn(scheme);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    expect(screen.queryByTestId('discover-lens', HIDDEN_OK)).toBeNull();
    await fireEvent.press(screen.getByTestId('retry-button'));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('Discover layout (A-Discover)', () => {
  type Node = { props: { style?: unknown; contentContainerStyle?: unknown }; parent: Node | null };
  const flat = (n: Node) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;

  it('the footer sits pinned above the tab bar: the content fills the screen and the footer takes margin-top auto', async () => {
    mockUser = { device: WEB_DEVICE };
    mockQuery = loaded(STUDIES);
    await renderIn('dark');
    const text = screen.getByText('New studies appear here when they match your device.');
    // The board's balanced break ("…appear here / when they match your device.").
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({ maxWidth: 180, textAlign: 'center' });
    // Up from the footer: the footer (margin-top auto, at least 28 above it), then every wrapper
    // up to the scroll content grows, so the auto margin takes the free room.
    let node = text.parent as Node | null;
    while (node && flat(node).marginTop !== 'auto') node = node.parent;
    expect(node && flat(node)).toMatchObject({ marginTop: 'auto', paddingTop: 28 });
    const results = screen.getByTestId('discover-results') as unknown as Node;
    expect(flat(results).flexGrow).toBe(1);
    for (node = node!.parent; node && node !== results; node = node.parent) {
      if (typeof (node as unknown as { type: unknown }).type === 'string') expect(flat(node).flexGrow).toBe(1);
    }
    while (node && node.props.contentContainerStyle === undefined) node = node.parent;
    expect(StyleSheet.flatten(node!.props.contentContainerStyle as never)).toMatchObject({ flexGrow: 1 });
  });
});

describe('Discover motion', () => {
  const results = () => getAnimatedStyle(screen.getByTestId('discover-results') as unknown as Parameters<typeof getAnimatedStyle>[0]) as unknown as { opacity: number; transform: { translateY: number }[] };

  it('a new result re-enters in place (opacity and 6dp, 240ms); the first state does not move', async () => {
    mockUser = { device: WEB_DEVICE };
    mockQuery = { isLoading: true, error: null, data: undefined, refetch: jest.fn() };
    const r = await renderIn('dark');
    expect(results().opacity).toBe(1);
    expect(screen.queryByTestId('discover-lens', HIDDEN_OK)).toBeNull();

    mockQuery = loaded(STUDIES);
    await r.rerender(tree());
    expect(screen.getByTestId('discover-lens', HIDDEN_OK)).toBeTruthy();
    await advance(16);
    expect(results().opacity).toBeLessThan(0.5);
    expect(results().transform[0]!.translateY).toBeGreaterThan(3);
    await advance(260);
    expect(results().opacity).toBe(1);
    expect(results().transform[0]!.translateY).toBe(0);

    // A refetch with the same kind of result changes nothing.
    mockQuery = loaded(STUDIES.slice(0, 1));
    await r.rerender(tree());
    expect(results().opacity).toBe(1);
  });

  it('reduced motion: the re-entry is a fade in place', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(true));
    mockUser = { device: WEB_DEVICE };
    mockQuery = { isLoading: true, error: null, data: undefined, refetch: jest.fn() };
    const r = await renderIn('dark');
    mockQuery = loaded([]);
    await r.rerender(tree());
    await advance(16);
    expect(results().opacity).toBeLessThan(0.9);
    expect(results().transform[0]!.translateY).toBe(0);
    await advance(140);
    expect(results().opacity).toBe(1);
  });
});
