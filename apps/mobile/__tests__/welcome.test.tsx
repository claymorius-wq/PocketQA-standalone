import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Index from '../app/index';
import Welcome from '../app/(auth)/welcome';
import { cameFromIntro, introPages, noteIntroLeft, pageAt, readIntroSeen, useIntroSeenWithSession } from '../src/onboarding/intro';
import { statusBand, TOUCH } from '../src/theme/tokens';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ArrivalContext } from '../src/ui';

// The intro (Welcome) a first-time visitor sees before Sign in, and the root route that opens it once.

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useRouter: () => ({ replace: mockReplace, push: mockPush }),
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
  };
});
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockSession: { ready: boolean; user: { id: string; role: string } | null; features: { testCredits: boolean } } = { ready: true, user: null, features: { testCredits: true } };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => mockSession }));
// The shared demo preview build (EXPO_PUBLIC_PREVIEW=1): a test flips the mocked module's flag.
jest.mock('../src/preview/demoAccounts', () => ({ ...jest.requireActual('../src/preview/demoAccounts'), PREVIEW_BUILD: false }));
const demoBuild = jest.requireMock<{ PREVIEW_BUILD: boolean }>('../src/preview/demoAccounts');

const WIDTH = 390;
const METRICS = { frame: { x: 0, y: 0, width: WIDTH, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider>{ui}</ThemeProvider>
  </SafeAreaProvider>
);

async function renderWelcome() {
  // As the auth layout opens it on a first visit: the launch.
  await render(
    wrap(
      <ArrivalContext.Provider value="launch">
        <Welcome />
      </ArrivalContext.Provider>,
    ),
  );
  // The pager draws once it knows its size.
  await fireEvent(screen.getByTestId('intro-pager-frame'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 600 } } });
}

/** The pager's scroll reaching `pages` (a fraction is mid-scroll), as the native scroll view reports it. */
async function scrollTo(pages: number) {
  await fireEvent.scroll(screen.getByTestId('intro-pager'), {
    nativeEvent: { contentOffset: { x: pages * WIDTH, y: 0 }, contentSize: { width: WIDTH * 3, height: 600 }, layoutMeasurement: { width: WIDTH, height: 600 } },
  });
}

const label = () => screen.getByTestId('intro-label');
/** A control that took another's place takes touches once it has arrived (SwapIn, 240ms). */
const arrived = () => act(() => new Promise((r) => setTimeout(r, 300)));

beforeEach(async () => {
  mockReplace.mockClear();
  mockPush.mockClear();
  demoBuild.PREVIEW_BUILD = false;
  mockSession = { ready: true, user: null, features: { testCredits: true } };
  await AsyncStorage.clear();
});

describe('Welcome', () => {
  it('opens on the first page, with its title as one heading', async () => {
    await renderWelcome();
    expect(label()).toHaveTextContent('POCKET QA');
    // One header, named by the whole title: the rising words are text, never a heading each, not
    // even the ones hidden from assistive tech while they rise.
    const headers = screen.getAllByRole('header');
    expect(headers).toHaveLength(1);
    expect(headers[0]!.props.accessibilityLabel).toBe('Usability tests on real phones');
    const title = screen.getByTestId('intro-title');
    expect(within(title).queryAllByRole('header', { includeHiddenElements: true }).filter((h) => h !== title)).toHaveLength(0);
    expect(screen.getByTestId('intro-skip')).toBeTruthy();
    expect(screen.getByTestId('intro-next')).toHaveTextContent('Next');
  });

  it('Next moves on once the pager settles, and the scroll in between never flips the page back', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-next'));
    // Mid-scroll: still the page that last settled, never a flip back and forth.
    await scrollTo(0.3);
    await scrollTo(0.6);
    expect(label()).toHaveTextContent('POCKET QA');
    // A second press mid-scroll goes one further than where the first is heading, not back.
    await fireEvent.press(screen.getByTestId('intro-next'));
    await scrollTo(1.4);
    expect(label()).toHaveTextContent('POCKET QA');
    await scrollTo(2);
    await waitFor(() => expect(label()).toHaveTextContent('FOR BUILDERS'));
    // The last page: no Next and no Skip; Create an account, and Sign in in the corner.
    expect(screen.queryByTestId('intro-next')).toBeNull();
    expect(screen.queryByTestId('intro-skip')).toBeNull();
    expect(screen.getByTestId('intro-get-started')).toHaveTextContent('Create an account');
    expect(screen.getByTestId('intro-sign-in')).toBeTruthy();
  });

  it('a swipe settles where the scroll rests, either way', async () => {
    await renderWelcome();
    await scrollTo(0.45);
    expect(label()).toHaveTextContent('POCKET QA');
    await scrollTo(1);
    await waitFor(() => expect(label()).toHaveTextContent('FOR TESTERS'));
    await scrollTo(0.5);
    await scrollTo(0);
    await waitFor(() => expect(label()).toHaveTextContent('POCKET QA'));
  });

  it('settles anyway when a programmatic scroll never reports back: where the pager is', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-next'));
    // Its last report was a hair short of the page (never within a pixel of it): after the
    // fallback, the page the pager is on settles.
    await scrollTo(0.995);
    expect(label()).toHaveTextContent('POCKET QA');
    await waitFor(() => expect(label()).toHaveTextContent('FOR TESTERS'), { timeout: 2000 });
  });

  it('the fallback settles where the pager rests, not where Next sent it', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-next'));
    // The web reports no drag: a wheel carries the pager on to the last page while Next is still
    // heading for the second. Resting on a page Next isn't heading for settles nothing yet.
    await scrollTo(1.5);
    await scrollTo(2);
    expect(label()).toHaveTextContent('POCKET QA');
    await waitFor(() => expect(label()).toHaveTextContent('FOR BUILDERS'), { timeout: 2000 });
  });

  it('Next, then dragged back before it arrived: the page it rests on stays the page', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-next'));
    await scrollTo(0.3);
    await scrollTo(0);
    // Past the fallback: nothing moves the state to where Next was heading.
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    expect(label()).toHaveTextContent('POCKET QA');
    expect(screen.getByTestId('intro-dot-0').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('intro-page-welcome').props['aria-hidden']).toBe(false);
    // Next still goes to the testers page, never past it.
    await fireEvent.press(screen.getByTestId('intro-next'));
    await scrollTo(1);
    await waitFor(() => expect(label()).toHaveTextContent('FOR TESTERS'));
  });

  it('a drag takes over from Next: the user’s own scroll decides', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-next'));
    await scrollTo(0.2);
    await fireEvent(screen.getByTestId('intro-pager'), 'scrollBeginDrag', { nativeEvent: { contentOffset: { x: 0.2 * WIDTH, y: 0 } } });
    // The finger holds the pager past halfway for longer than Next's fallback: nothing settles
    // under it (Next's fallback would settle the page the pager is nearest).
    await scrollTo(0.6);
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    expect(label()).toHaveTextContent('POCKET QA');
    // Let go: the page it comes to rest on settles.
    await scrollTo(1);
    await waitFor(() => expect(label()).toHaveTextContent('FOR TESTERS'));
  });

  it('a quick second Next passing exactly over the middle page never settles it on the way', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-next'));
    await scrollTo(0.5);
    await fireEvent.press(screen.getByTestId('intro-next'));
    // One scroll sample lands right on page 2 while Next is heading for page 3.
    await scrollTo(1);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(label()).toHaveTextContent('POCKET QA');
    await scrollTo(2);
    await waitFor(() => expect(label()).toHaveTextContent('FOR BUILDERS'));
  });

  it('Skip goes to Sign in, remembers the intro was seen, and hands over to Sign in', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-skip'));
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
    expect(mockPush).not.toHaveBeenCalled();
    expect(cameFromIntro()).toBe(true);
    await waitFor(async () => expect(await readIntroSeen()).toBe(true));
  });

  it('Create an account opens Sign up over the intro (Back returns here); Sign in takes its place', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-dot-2'));
    await scrollTo(2);
    await waitFor(() => expect(screen.getByTestId('intro-get-started')).toHaveTextContent('Create an account'));
    await arrived();
    await fireEvent.press(screen.getByTestId('intro-get-started'));
    expect(mockPush).toHaveBeenLastCalledWith('/sign-up');
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('intro-sign-in'));
    expect(mockReplace).toHaveBeenLastCalledWith('/sign-in');
    await waitFor(async () => expect(await readIntroSeen()).toBe(true));
  });

  it('a control that replaced another takes no touches until it has arrived', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-dot-2'));
    await scrollTo(2);
    await waitFor(() => expect(screen.getByTestId('intro-get-started')).toBeTruthy());
    // A quick second tap meant for Next lands on nothing.
    await fireEvent.press(screen.getByTestId('intro-get-started'));
    expect(mockPush).not.toHaveBeenCalled();
    await arrived();
    await fireEvent.press(screen.getByTestId('intro-get-started'));
    expect(mockPush).toHaveBeenCalledWith('/sign-up');
  });

  it('in the shared demo preview the last page is Explore the demo, with no Sign up and no second way in', async () => {
    demoBuild.PREVIEW_BUILD = true;
    await renderWelcome();
    await fireEvent.press(screen.getByTestId('intro-dot-2'));
    await scrollTo(2);
    await waitFor(() => expect(screen.getByTestId('intro-get-started')).toHaveTextContent('Explore the demo'));
    expect(screen.queryByTestId('intro-sign-in')).toBeNull();
    expect(screen.queryByTestId('intro-skip')).toBeNull();
    await arrived();
    await fireEvent.press(screen.getByTestId('intro-get-started'));
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('hides the pages out of view from assistive tech, and each dot is a 48dp button to its page', async () => {
    await renderWelcome();
    expect(screen.getByTestId('intro-page-welcome').props['aria-hidden']).toBe(false);
    // Hidden from assistive tech: the default query (which skips hidden elements) cannot see it.
    expect(screen.queryByTestId('intro-page-testers')).toBeNull();
    expect(screen.getByTestId('intro-page-testers', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    const dot = screen.getByTestId('intro-dot-0');
    expect(dot.props.accessibilityRole).toBe('button');
    expect(dot.props.accessibilityLabel).toBe('Go to page 1 of 3');
    expect(dot.props.accessibilityState).toMatchObject({ selected: true });
    expect(dot).toHaveStyle({ width: TOUCH, height: TOUCH });
    await fireEvent.press(screen.getByTestId('intro-dot-1'));
    await scrollTo(1);
    await waitFor(() => expect(screen.getByTestId('intro-page-testers', { includeHiddenElements: true }).props['aria-hidden']).toBe(false));
    expect(screen.getByTestId('intro-dot-1').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('intro-dot-0').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('announces a page once it settles (not on opening), queued on iOS so a focus move can’t drop it', async () => {
    // React Native's Jest setup already mocks it, so spyOn returns that mock with every earlier
    // test's calls on it: start from none. (Jest runs as iOS.)
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => undefined);
    announce.mockClear();
    await renderWelcome();
    await arrived();
    expect(announce).not.toHaveBeenCalled();
    await scrollTo(1);
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Page 2 of 3. Test apps on your own phone', { queue: true }));
    announce.mockRestore();
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

  it('a signed-in user goes to their tab', async () => {
    mockSession = { ready: true, user: { id: 't1', role: 'tester' }, features: { testCredits: true } };
    await render(wrap(<Index />));
    await waitFor(() => expect(screen.getByTestId('redirect')).toHaveTextContent('/discover'));
  });

  it('never shows the intro to someone who has had a session, however they reached the app', async () => {
    const { rerender } = await renderHook(({ signedIn }: { signedIn: boolean }) => useIntroSeenWithSession(signedIn), { initialProps: { signedIn: false } });
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(await readIntroSeen()).toBe(false);
    await rerender({ signedIn: true });
    await waitFor(async () => expect(await readIntroSeen()).toBe(true));
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

  it('the hand-over to Sign in lasts as long as an arrival stamp', () => {
    noteIntroLeft(10_000);
    expect(cameFromIntro(10_500)).toBe(true);
    expect(cameFromIntro(12_000)).toBe(true);
    expect(cameFromIntro(12_001)).toBe(false);
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
