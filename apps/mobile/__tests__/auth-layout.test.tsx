import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { takeArrival } from '../src/motion/entrance';
import { armU1, disarmU1, u1Armed, u1PassAt } from '../src/screens/authParts';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import AuthLayout from '../app/(auth)/_layout';

// The auth layout's U1 hand-off (CONSISTENCY §M3, C4): after a Sign in press succeeds, the
// redirect waits for the Commit pass to peak (max(press + 280, response) + 680), then the first
// tab gets `replace` with the `u1` tail. Sign up, a restored session, reduced motion and the flat
// theme leave at once with the plain `replace`.

jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Stack: () => createElement(View, { testID: 'auth-stack' }),
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
  };
});

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type MockUser = { id: string };
let mockUser: MockUser | null = null;
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ ready: true, user: mockUser }) }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
let setPreference: ((p: ThemePreference) => void) | undefined;
function Scheme({ children }: { children: ReactNode }) {
  setPreference = useTheme().setPreference;
  return <>{children}</>;
}
const tree = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">
      <Scheme>
        <AuthLayout />
      </Scheme>
    </ThemeProvider>
  </SafeAreaProvider>
);
async function mount(scheme: ThemePreference = 'dark') {
  const r = await render(tree());
  await act(async () => setPreference?.(scheme));
  return r;
}
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

let reduced = false;
beforeEach(() => {
  jest.useFakeTimers();
  mockUser = null;
  reduced = false;
  disarmU1();
  takeArrival();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduced));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('U1 pass timing', () => {
  it('starts the pass at max(press + 280, the response), fixed once', () => {
    expect(u1PassAt(1000)).toBeNull();
    armU1(1000);
    expect(u1Armed()).toBe(true);
    expect(u1PassAt(1100)).toBe(1280);
    expect(u1PassAt(1500)).toBe(1280);
    armU1(2000);
    expect(u1PassAt(2900)).toBe(2900);
    disarmU1();
    expect(u1Armed()).toBe(false);
  });
});

describe('Auth layout', () => {
  it('holds Sign in for the Commit pass, then replaces it with the u1 tail at the pass peak', async () => {
    const r = await mount();
    expect(screen.getByTestId('auth-stack')).toBeTruthy();
    armU1(Date.now());
    await advance(100); // the response comes back 100ms after the press
    mockUser = { id: 'tester' };
    await r.rerender(tree());
    // The pass starts at press + 280 and peaks 680 later: Sign in stays up until then.
    await advance(800);
    expect(screen.getByTestId('auth-stack')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(takeArrival()).toBeNull();
    await advance(70);
    expect(screen.getByTestId('redirect')).toBeTruthy();
    expect(takeArrival()).toEqual({ arrival: 'replace', handoff: 'u1' });
    expect(u1Armed()).toBe(false);
  });

  it('gives Sign up (nothing armed) the plain replace at once', async () => {
    const r = await mount();
    mockUser = { id: 'new-builder' };
    await r.rerender(tree());
    await act(async () => undefined);
    expect(screen.getByTestId('redirect')).toBeTruthy();
    expect(takeArrival()).toEqual({ arrival: 'replace' });
  });

  it.each([
    ['reduced motion', 'dark' as const, true],
    ['the flat light theme', 'light' as const, false],
  ])('leaves at once under %s, with no u1 tail', async (_, scheme, isReduced) => {
    reduced = isReduced;
    const r = await mount(scheme);
    await act(async () => undefined);
    armU1(Date.now());
    mockUser = { id: 'tester' };
    await r.rerender(tree());
    await act(async () => undefined);
    expect(screen.getByTestId('redirect')).toBeTruthy();
    expect(takeArrival()).toEqual({ arrival: 'replace' });
    expect(u1Armed()).toBe(false);
  });
});
