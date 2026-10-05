import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Index from '../app/index';
import Welcome from '../app/(auth)/welcome';
import { introPages, pageAt, readIntroSeen } from '../src/onboarding/intro';
import { statusBand } from '../src/theme/tokens';
import { ThemeProvider } from '../src/theme/ThemeProvider';

// The intro (Welcome) a first-time visitor sees before Sign in, and the root route that opens it once.

const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useRouter: () => ({ replace: mockReplace }),
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
  };
});
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockSession: { ready: boolean; user: { id: string; role: string } | null; features: { testCredits: boolean } } = { ready: true, user: null, features: { testCredits: true } };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => mockSession }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider>{ui}</ThemeProvider>
  </SafeAreaProvider>
);

async function renderWelcome() {
  await render(wrap(<Welcome />));
  // The pager draws once it knows its size.
  await fireEvent(screen.getByTestId('intro-pager-frame'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } });
}

beforeEach(async () => {
  mockReplace.mockClear();
  mockSession = { ready: true, user: null, features: { testCredits: true } };
  await AsyncStorage.clear();
});

describe('Welcome', () => {
  it('opens on the first page and moves through the pages with Next', async () => {
    await renderWelcome();
    expect(screen.getByTestId('intro-label')).toHaveTextContent('POCKET QA');
    expect(screen.getByText('Usability tests on real phones')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('intro-next'));
    expect(screen.getByTestId('intro-label')).toHaveTextContent('FOR TESTERS');
    await fireEvent.press(screen.getByTestId('intro-next'));
    expect(screen.getByTestId('intro-label')).toHaveTextContent('FOR BUILDERS');
    // The last page has no Next and no Skip: its way in is the primary.
    expect(screen.queryByTestId('intro-next')).toBeNull();
    expect(screen.queryByTestId('intro-skip')).toBeNull();
  });

  it('Skip goes to Sign in and remembers the intro was seen', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-skip'));
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
    await waitFor(async () => expect(await readIntroSeen()).toBe(true));
  });

  it('the last page offers Create an account and Sign in (outside the shared preview)', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-dot-2'));
    expect(screen.getByTestId('intro-get-started')).toHaveTextContent('Create an account');
    await fireEvent.press(screen.getByTestId('intro-get-started'));
    expect(mockReplace).toHaveBeenLastCalledWith('/sign-up');
    await fireEvent.press(screen.getByTestId('intro-sign-in'));
    expect(mockReplace).toHaveBeenLastCalledWith('/sign-in');
    await waitFor(async () => expect(await readIntroSeen()).toBe(true));
  });

  it('hides the pages out of view from assistive tech, and the dots say where you are', async () => {
    await renderWelcome();
    expect(screen.getByTestId('intro-page-welcome').props['aria-hidden']).toBe(false);
    // Hidden from assistive tech: the default query (which skips hidden elements) cannot see it.
    expect(screen.queryByTestId('intro-page-testers')).toBeNull();
    expect(screen.getByTestId('intro-page-testers', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    expect(screen.getByTestId('intro-dots').props.accessibilityLabel).toBe('Page 1 of 3');
    expect(screen.getByTestId('intro-dot-0').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('intro-dot-1'));
    expect(screen.getByTestId('intro-page-testers', { includeHiddenElements: true }).props['aria-hidden']).toBe(false);
    expect(screen.getByTestId('intro-dots').props.accessibilityLabel).toBe('Page 2 of 3');
  });
});

describe('the root route', () => {
  it('opens the intro on a first visit, then Sign in once it has been seen', async () => {
    await render(wrap(<Index />));
    await waitFor(() => expect(screen.getByTestId('redirect')).toHaveTextContent('/welcome'));
    await act(() => AsyncStorage.setItem('pocketqa.introSeen', '1'));
    await render(wrap(<Index />));
    await waitFor(() => expect(screen.getByTestId('redirect')).toHaveTextContent('/sign-in'));
  });

  it('never shows the intro to a signed-in user', async () => {
    mockSession = { ready: true, user: { id: 't1', role: 'tester' }, features: { testCredits: true } };
    await render(wrap(<Index />));
    await waitFor(() => expect(screen.getByTestId('redirect')).toHaveTextContent('/discover'));
  });
});

describe('intro helpers', () => {
  it('names the reward only where test credits are on, and never promises one', () => {
    const credits = JSON.stringify(introPages({ testCredits: true }));
    const none = JSON.stringify(introPages({ testCredits: false }));
    expect(credits).toContain('test credits');
    expect(none).not.toContain('test credits');
    for (const copy of [credits, none]) expect(copy).toContain('never guaranteed');
  });

  it('pageAt rounds to the nearest page and stays in range', () => {
    expect(pageAt(0, 390, 3)).toBe(0);
    expect(pageAt(390 * 0.6, 390, 3)).toBe(1);
    expect(pageAt(390 * 9, 390, 3)).toBe(2);
    expect(pageAt(-50, 390, 3)).toBe(0);
    expect(pageAt(100, 0, 3)).toBe(0);
  });

  it('storage that cannot be read counts as seen, so the intro never blocks Sign in', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('denied'));
    expect(await readIntroSeen()).toBe(true);
    spy.mockRestore();
  });
});

describe('statusBand', () => {
  it('keeps the boards’ 44 on native, whatever the inset', () => {
    expect(statusBand(0, false)).toBe(44);
    expect(statusBand(24, false)).toBe(44);
    expect(statusBand(59, false)).toBe(59);
  });

  it('on web is only the page’s own inset, with a little room in a browser tab', () => {
    expect(statusBand(0, true)).toBe(10);
    expect(statusBand(47, true)).toBe(47);
  });
});
