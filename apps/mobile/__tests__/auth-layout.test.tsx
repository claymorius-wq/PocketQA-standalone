import { act, render, screen } from '@testing-library/react-native';
import { useContext, type ReactNode } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { takeArrival } from '../src/motion/entrance';
import { noteIntroLeft } from '../src/onboarding/intro';
import { armU1, disarmU1, u1Armed, u1PassAt } from '../src/screens/authParts';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import { ArrivalContext } from '../src/ui';
import AuthLayout from '../app/(auth)/_layout';

// The auth layout's U1 hand-off (CONSISTENCY §M3, C4): after a Sign in press succeeds, the
// redirect waits for the Commit pass to peak (max(press + 280, response) + 680), then the first
// tab gets `replace` with the `u1` tail. Sign up, a restored session, reduced motion and the flat
// theme leave at once with the plain `replace`.

type Route = { key: string; name: string };
type ScreenLayout = (p: { route: Route; navigation: { getState: () => { routes: Route[] } }; children: ReactNode }) => ReactNode;
// The props the layout last gave its Stack (its screenLayout decides how each screen opens).
let mockStack: { screenLayout?: ScreenLayout } = {};
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Stack: (props: { screenLayout?: ScreenLayout }) => {
      mockStack = props;
      return createElement(View, { testID: 'auth-stack' });
    },
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

describe('how each auth screen opens', () => {
  // The intro's hand-over stamp is module state: forget it, so no later test inherits it.
  afterEach(() => noteIntroLeft(-Infinity));
  function Arrival() {
    return <Text testID="arrival">{String(useContext(ArrivalContext))}</Text>;
  }
  /** The arrival the layout gives `name` when the auth stack holds `stack` (route names, bottom first). */
  async function arrivalOf(name: string, stack: string[]) {
    const routes = stack.map((n) => ({ key: `${n}-key`, name: n }));
    const route = routes.find((r) => r.name === name)!;
    await render(<>{mockStack.screenLayout!({ route, navigation: { getState: () => ({ routes }) }, children: <Arrival /> })}</>);
    return screen.getByTestId('arrival').props.children as string;
  }

  it('the launch belongs to the first screen of a visit: the intro, or Sign in', async () => {
    await mount();
    expect(await arrivalOf('welcome', ['welcome'])).toBe('launch');
    expect(await arrivalOf('sign-in', ['sign-in'])).toBe('launch');
  });

  it('any screen after the first arrives with a push; Sign up takes the default', async () => {
    await mount();
    expect(await arrivalOf('sign-in', ['welcome', 'sign-up', 'sign-in'])).toBe('push');
    expect(await arrivalOf('sign-up', ['welcome', 'sign-up'])).toBe('null');
    expect(await arrivalOf('sign-up', ['sign-up'])).toBe('null');
  });

  it('Sign in that took the intro’s place arrives with a push, and a later visit’s is a launch again', async () => {
    await mount();
    noteIntroLeft();
    expect(await arrivalOf('sign-in', ['sign-in'])).toBe('push');
    await advance(2001);
    expect(await arrivalOf('sign-in', ['sign-in'])).toBe('launch');
  });
});
