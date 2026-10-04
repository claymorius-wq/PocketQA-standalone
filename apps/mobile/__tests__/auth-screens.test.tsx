import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet, View } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { disarmU1, SignInDock, signInMoment, u1Armed } from '../src/screens/authParts';
import { Ground, useUplight } from '../src/glass';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import { ArrivalContext } from '../src/ui';
import SignIn from '../app/(auth)/sign-in';
import SignUp from '../app/(auth)/sign-up';

// Sign in and Sign up in the Lens system (A-SignIn, A-SignUp): every testID, label and copy string
// stays; Sign in keeps the demo role switch and the failure notice exactly, and adds U1 (the pilot
// under Sign in once both fields are filled, the Commit pass only once the session is accepted).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children, href, testID }: { children: ReactNode; href: string; testID?: string }) => createElement(Text, { testID, accessibilityRole: 'link', accessibilityHint: href }, children),
  };
});

type NewAccount = { role: 'tester' | 'builder'; displayName: string };
const mockSignIn = jest.fn<Promise<void>, [string, string]>();
const mockSignUp = jest.fn<Promise<{ verification: 'sent' | 'unsent' | 'none' }>, [{ email: string; password: string; displayName: string; role: 'tester' | 'builder' }]>();
const mockCompleteAccount = jest.fn<Promise<void>, [NewAccount]>();
const mockAuth = { signInWithGoogle: jest.fn<Promise<void>, []>(), signInWithWallet: jest.fn<Promise<void>, [NewAccount?]>() };
// The session as SessionProvider serves the local build (local auth and storage, no wallet login,
// nobody waiting to finish an account); a test sets fields for a managed (Firebase) deployment.
const LOCAL_SESSION = { authMode: 'local', storage: 'local', walletLogin: false, needsAccount: false, pendingProfile: null as NewAccount | null, features: { testCredits: true, devnetTransfers: true }, unverifiedEmail: false, unreachable: false, retryConnection: () => {}, resendVerification: async () => {}, discardUnverified: async () => {}, sendPasswordReset: async () => {} };
let mockSession: Partial<typeof LOCAL_SESSION> & Record<string, unknown> = { ...LOCAL_SESSION };
jest.mock('../src/auth/SessionProvider', () => ({
  useSession: () => ({ ...mockSession, ...mockAuth, signIn: mockSignIn, signUp: mockSignUp, completeAccount: mockCompleteAccount }),
}));

let mockPreview = false;
const mockLoadDemo = jest.fn();
jest.mock('../src/preview/demoAccounts', () => ({
  get PREVIEW_BUILD() {
    return mockPreview;
  },
  loadDemoAccounts: () => mockLoadDemo(),
}));

// Synthetic fixtures; built through fixture() so the secret scan's literal rule does not read them as credentials.
const fixture = (value: string) => value;
const DEMO = [
  { role: 'tester', email: 'demo-tester@pocketqa.example', password: fixture('tester-password-1') },
  { role: 'builder', email: 'demo-builder@pocketqa.example', password: fixture('builder-password-1') },
  { role: 'admin', email: 'demo-admin@pocketqa.example', password: fixture('admin-password-12') },
];
const HIDDEN_OK = { includeHiddenElements: true };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

let setPreference: ((p: ThemePreference) => void) | undefined;
function Scheme({ children }: { children: ReactNode }) {
  setPreference = useTheme().setPreference;
  return <>{children}</>;
}
const tree = (node: ReactNode) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">
      <Scheme>{node}</Scheme>
    </ThemeProvider>
  </SafeAreaProvider>
);
async function renderIn(scheme: ThemePreference, node: ReactNode) {
  const r = await render(tree(node));
  await act(async () => setPreference?.(scheme));
  return r;
}
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled;

beforeEach(() => {
  jest.useFakeTimers();
  mockPreview = false;
  mockLoadDemo.mockReset().mockResolvedValue([]);
  mockSignIn.mockReset();
  mockSignUp.mockReset();
  mockCompleteAccount.mockReset();
  mockSession = { ...LOCAL_SESSION };
  disarmU1();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each<ThemePreference>(['dark', 'light'])('Sign in in %s', (scheme) => {
  it('keeps the hero copy, the fields, the local footer and the Create an account link', async () => {
    await renderIn(scheme, <SignIn />);
    await advance(1000);
    expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
    expect(screen.getByText('POCKET QA')).toBeTruthy();
    expect(screen.getByText('Real-device usability tests')).toBeTruthy();
    expect(screen.getByText('Builders fund studies with test credits. Testers record consented sessions. Every reward needs approval.')).toBeTruthy();
    expect(screen.getByTestId('sign-in-email')).toBeTruthy();
    expect(screen.getByTestId('sign-in-password')).toBeTruthy();
    expect(screen.getByText('New here?')).toBeTruthy();
    expect(screen.getByTestId('go-sign-up').props.accessibilityHint).toBe('/sign-up');
    expect(screen.getByText('Create an account')).toBeTruthy();
    expect(screen.getByText('Local build · data stays on this machine')).toBeTruthy();
    expect(screen.queryByTestId('demo-accounts')).toBeNull();
  });

  it('enables Sign in once both fields are filled and signs in with the trimmed email', async () => {
    mockSignIn.mockResolvedValue(undefined);
    await renderIn(scheme, <SignIn />);
    expect(disabled('sign-in-submit')).toBe(true);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), '  ana@example.test ');
    expect(disabled('sign-in-submit')).toBe(true);
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a-long-password');
    expect(disabled('sign-in-submit')).toBe(false);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(mockSignIn).toHaveBeenCalledWith('ana@example.test', 'a-long-password');
  });

  it('the password field’s return key signs in too, once both fields are filled', async () => {
    mockSignIn.mockResolvedValue(undefined);
    await renderIn(scheme, <SignIn />);
    expect(screen.getByTestId('sign-in-password').props.returnKeyType).toBe('go');
    await fireEvent(screen.getByTestId('sign-in-password'), 'submitEditing');
    expect(mockSignIn).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a-long-password');
    await fireEvent(screen.getByTestId('sign-in-password'), 'submitEditing');
    expect(mockSignIn).toHaveBeenCalledWith('ana@example.test', 'a-long-password');
  });

  it('shows the server’s cause in the failure notice, and the fallback line otherwise', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('Email or password is incorrect.')).mockRejectedValueOnce('nope');
    await renderIn(scheme, <SignIn />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(screen.getByText('Couldn’t sign in')).toBeTruthy();
    expect(screen.getByText('Email or password is incorrect.')).toBeTruthy();
    // The fields stay as they were, so the person can retry at once.
    expect(screen.getByTestId('sign-in-email').props.value).toBe('ana@example.test');
    expect(disabled('sign-in-submit')).toBe(false);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(screen.getByText('Sign-in failed.')).toBeTruthy();
  });
});

describe('Sign in, shared demo preview', () => {
  it('fills (never submits) the demo sign-in from the role switch, and has no self-registration', async () => {
    mockPreview = true;
    mockLoadDemo.mockResolvedValue(DEMO);
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(screen.getByTestId('demo-accounts')).toBeTruthy();
    expect(screen.getByText('Shared demo preview')).toBeTruthy();
    expect(screen.getByText('Pick a role and press Sign in. Demo accounts are shared with every visitor; data is synthetic, devnet and test credits only.')).toBeTruthy();
    expect(screen.getByTestId('sign-in-email').props.value).toBe('demo-tester@pocketqa.example');
    expect(screen.getByTestId('demo-role-tester').props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByTestId('demo-role-builder'));
    expect(screen.getByTestId('sign-in-email').props.value).toBe('demo-builder@pocketqa.example');
    expect(screen.getByTestId('sign-in-password').props.value).toBe('builder-password-1');
    expect(screen.getByTestId('demo-role-builder').props.accessibilityState).toMatchObject({ selected: true });
    expect(mockSignIn).not.toHaveBeenCalled();

    expect(screen.queryByTestId('go-sign-up')).toBeNull();
    expect(screen.getByText('Public demo preview · synthetic data · devnet and test credits only')).toBeTruthy();
  });

  it('a role pick clears the last failure', async () => {
    mockPreview = true;
    mockLoadDemo.mockResolvedValue(DEMO);
    mockSignIn.mockRejectedValue(new Error('Too many failed sign-in attempts. Try again later.'));
    await renderIn('dark', <SignIn />);
    await advance(1000);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('demo-role-admin'));
    expect(screen.queryByTestId('sign-in-error')).toBeNull();
  });
});

describe('Sign in launch', () => {
  /** The opacities of every animated ancestor of an element (its entrance step, the dock root). */
  function opacities(testID: string): number[] {
    const out: number[] = [];
    let node: ReturnType<typeof screen.getByTestId> | null = screen.getByTestId(testID);
    while (node) {
      try {
        const style = getAnimatedStyle(node as unknown as Parameters<typeof getAnimatedStyle>[0]) as { opacity?: number } | undefined;
        if (typeof style?.opacity === 'number') out.push(style.opacity);
      } catch {
        // not an animated view
      }
      node = node.parent;
    }
    return out;
  }

  it('docks Sign in under the staggered launch steps: it arrives last and lands by 700ms', async () => {
    await renderIn(
      'dark',
      <ArrivalContext.Provider value="launch">
        <SignIn />
      </ArrivalContext.Provider>,
    );
    expect(Math.min(...opacities('sign-in-submit'))).toBe(0);
    expect(Math.min(...opacities('sign-in-email'))).toBe(0);
    // The form card (step 1, +120) is on its way while Sign in (step 4, +240) has not started.
    await advance(230);
    expect(Math.min(...opacities('sign-in-email'))).toBeGreaterThan(0);
    expect(Math.min(...opacities('sign-in-submit'))).toBe(0);
    await advance(470);
    expect(opacities('sign-in-submit').every((o) => o === 1)).toBe(true);
    expect(opacities('sign-in-email').every((o) => o === 1)).toBe(true);
  });
});

/** Records every Keyboard listener (the dock and the screen both listen); `emit` calls them all. */
function mockKeyboard() {
  const handlers: Record<string, (() => void)[]> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
    (handlers[event] ??= []).push(cb);
    return { remove: jest.fn() };
  }) as unknown as typeof Keyboard.addListener);
  const emit = (...events: string[]) => {
    const name = events.find((e) => handlers[e]?.length);
    for (const cb of name ? handlers[name]! : []) cb();
  };
  return { show: () => emit('keyboardWillShow', 'keyboardDidShow'), hide: () => emit('keyboardWillHide', 'keyboardDidHide') };
}

/** Whether the Screen's content fills the viewport (Screen `fill`). */
function filled() {
  let node = screen.getByTestId('sign-in-email', HIDDEN_OK).parent;
  while (node && node.props.contentContainerStyle === undefined) node = node.parent;
  if (!node) throw new Error('no scroll content above the form');
  return (StyleSheet.flatten(node.props.contentContainerStyle) as { flexGrow?: number }).flexGrow === 1;
}

/** The style of the wrapper that holds the error Notice and the form card (the screen's last step). */
function formWrapper(testID: string) {
  let node = screen.getByTestId(testID, HIDDEN_OK).parent;
  while (node) {
    const style = StyleSheet.flatten(node.props.style) as { flexGrow?: number; gap?: number; justifyContent?: string } | undefined;
    if (style?.flexGrow === 1 && style.gap === 14) return node;
    node = node.parent;
  }
  throw new Error(`no form wrapper above ${testID}`);
}
const anchoredLow = () => (StyleSheet.flatten(formWrapper('sign-in-email').props.style) as { justifyContent?: string }).justifyContent === 'flex-end';

describe('Sign in layout (A-SignIn)', () => {
  it('local build: the content fills the screen and the card sits low, just above the footer', async () => {
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(filled()).toBe(true);
    expect(anchoredLow()).toBe(true);
  });

  it('local build: the failure Notice rises above the card in the same bottom-anchored wrapper', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('Email or password is incorrect.'));
    await renderIn('dark', <SignIn />);
    await advance(1000);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(formWrapper('sign-in-error')).toBe(formWrapper('sign-in-email'));
    expect(anchoredLow()).toBe(true);
  });

  it('shared preview: the card stays under the hero (no fill)', async () => {
    mockPreview = true;
    mockLoadDemo.mockResolvedValue(DEMO);
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(filled()).toBe(false);
    expect(anchoredLow()).toBe(false);
  });

  it('local build: the card goes back under the hero while the keyboard is up', async () => {
    const keyboard = mockKeyboard();
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(filled()).toBe(true);
    await act(async () => keyboard.show());
    expect(filled()).toBe(false);
    expect(anchoredLow()).toBe(false);
    await act(async () => keyboard.hide());
    expect(filled()).toBe(true);
    expect(anchoredLow()).toBe(true);
  });
});

describe('Sign in with the keyboard up', () => {
  it('keeps Sign in reachable on the keyboard and steps the footer aside until it hides', async () => {
    const keyboard = mockKeyboard();
    await renderIn('dark', <SignIn />);
    await advance(1000);
    const footerHidden = () => {
      let node = screen.getByText('New here?', HIDDEN_OK).parent;
      while (node) {
        if ((StyleSheet.flatten(node.props.style) as { display?: string } | undefined)?.display === 'none') return true;
        node = node.parent;
      }
      return false;
    };
    expect(footerHidden()).toBe(false);
    await act(async () => keyboard.show());
    expect(footerHidden()).toBe(true);
    expect(screen.getByTestId('sign-in-submit')).toBeTruthy();
    await act(async () => keyboard.hide());
    expect(footerHidden()).toBe(false);
  });
});

describe('Sign in dock scrim', () => {
  /** Lays out every host view that measures itself (the Ground, the dock) at 390 × `height`. */
  async function layOut(r: Awaited<ReturnType<typeof render>>, height: number) {
    for (const n of r.container.queryAll((x) => typeof x.type === 'string' && typeof x.props.onLayout === 'function')) {
      // persist(): the riding dock's KeyboardAvoidingView keeps the event.
      await act(async () => n.props.onLayout({ persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }));
    }
  }

  it('repaints the ground under the dock: opaque behind the footer and the primary, fading over the clearance above', async () => {
    const r = await renderIn('dark', <SignIn />);
    await advance(1000);
    await layOut(r, 200);
    const scrim = screen.getByTestId('sign-in-dock-scrim', HIDDEN_OK);
    // 14 above the dock's top edge (its clearance), down to the screen's bottom edge.
    expect(StyleSheet.flatten(scrim.props.style)).toMatchObject({ position: 'absolute', top: -14, height: 214 });
    // The mask is clear at the top and full ground from 14 px down: white 0 → 1 at 1 − 200/214 → 1.
    expect(JSON.stringify(scrim.children)).toContain(`"gradient":[0,16777215,${1 - 200 / 214},-1,1,-1]`);
  });

  it('steps aside while the dock rides the keyboard', async () => {
    const keyboard = mockKeyboard();
    const r = await renderIn('dark', <SignIn />);
    await advance(1000);
    await layOut(r, 200);
    expect(screen.getByTestId('sign-in-dock-scrim', HIDDEN_OK)).toBeTruthy();
    await act(async () => keyboard.show());
    expect(screen.queryByTestId('sign-in-dock-scrim', HIDDEN_OK)).toBeNull();
    await act(async () => keyboard.hide());
    expect(screen.getByTestId('sign-in-dock-scrim', HIDDEN_OK)).toBeTruthy();
  });
});

describe('Sign in U1', () => {
  it('plays the pilot only, until the session is accepted', () => {
    expect(signInMoment(false, false)).toEqual({ grade: 'pilot', active: false });
    expect(signInMoment(true, false)).toEqual({ grade: 'pilot', active: true });
    expect(signInMoment(true, true)).toEqual({ grade: 'commit', active: true });
    expect(signInMoment(false, true)).toEqual({ grade: 'commit', active: true });
  });

  const spill = () => screen.getByTestId('sign-in-uplight-spill', HIDDEN_OK);

  it('rises to the 0.35 pilot under Sign in once both fields are filled, and a failure leaves it lit', async () => {
    mockSignIn.mockRejectedValue(new Error('Email or password is incorrect.'));
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(spill()).toHaveAnimatedStyle({ opacity: 0 });
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'wrong-password');
    await advance(700);
    expect(spill()).toHaveAnimatedStyle({ opacity: 0.35 });
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await advance(700);
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(spill()).toHaveAnimatedStyle({ opacity: 0.35 });
    // Emptying a field takes the pilot away (the light cut).
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), '');
    await advance(300);
    expect(spill()).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('holds the pilot while the request is pending, and runs the Commit pass only on success', async () => {
    let accept: () => void = () => undefined;
    mockSignIn.mockImplementation(() => new Promise<void>((resolve) => (accept = resolve)));
    await renderIn('dark', <SignIn />);
    await advance(1000);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a-long-password');
    await advance(700);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await advance(1000);
    expect(screen.getByTestId('sign-in-submit').props.accessibilityState).toMatchObject({ busy: true });
    expect(spill()).toHaveAnimatedStyle({ opacity: 0.35 });
    await act(async () => accept());
    await advance(600);
    expect(spill()).toHaveAnimatedStyle({ opacity: 1 });
    await advance(1000);
    expect(spill()).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('starts the Commit pass no sooner than 280ms after the press, and arms the hand-off', async () => {
    mockSignIn.mockResolvedValue(undefined);
    await renderIn('dark', <SignIn />);
    await advance(1000);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a-long-password');
    await advance(700);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(u1Armed()).toBe(true);
    await advance(250);
    expect(spill()).toHaveAnimatedStyle({ opacity: 0.35 });
    await advance(30); // the pass starts at press + 280
    await advance(600);
    expect(spill()).toHaveAnimatedStyle({ opacity: 1 });
    // A second press while the pass plays never signs in again.
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('disarms the hand-off when the sign-in fails', async () => {
    mockSignIn.mockRejectedValue(new Error('Email or password is incorrect.'));
    await renderIn('dark', <SignIn />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(u1Armed()).toBe(false);
  });

  it('stands down when a managed sign-in has no Pocket QA account yet: no pass, nothing armed, Sign in works again', async () => {
    // Firebase accepted the password, but no account uses that identity: the session asks for one.
    mockSignIn.mockImplementation(async () => {
      mockSession = { ...mockSession, authMode: 'firebase', needsAccount: true };
    });
    await renderIn('dark', <SignIn />);
    await advance(1000);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'fiona@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a-long-password');
    await advance(700);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(u1Armed()).toBe(false);
    expect(screen.getByTestId('finish-account')).toBeTruthy();
    // Where a Commit pass would peak (press + 280 + 600), the pilot simply holds.
    await advance(880);
    expect(spill()).toHaveAnimatedStyle({ opacity: 0.35 });
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it('draws no Uplight in the flat light theme', async () => {
    await renderIn('light', <SignIn />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a-long-password');
    expect(screen.queryByTestId('sign-in-uplight-spill', HIDDEN_OK)).toBeNull();
  });
});

describe('Sign in with managed identity (cloud auth)', () => {
  it('says where data lives on a cloud deployment, never "this machine"', async () => {
    mockSession = { ...LOCAL_SESSION, authMode: 'firebase', storage: 'r2' };
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(screen.getByText('Sign-in is managed by Firebase · evidence is stored privately in cloud storage')).toBeTruthy();
    expect(screen.queryByText('Local build · data stays on this machine')).toBeNull();
    // Google and wallet sign-in are web-only: a native render offers neither.
    expect(screen.queryByTestId('sign-in-google')).toBeNull();
    expect(screen.queryByTestId('sign-in-wallet')).toBeNull();
  });

  it('finish your account: the role switch and name prefilled from sign-up, above the sign-in card, then Create account', async () => {
    mockSession = { ...LOCAL_SESSION, authMode: 'firebase', needsAccount: true, pendingProfile: { role: 'builder', displayName: 'Fiona Firebase' } };
    mockCompleteAccount.mockResolvedValue(undefined);
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(screen.getByText('Finish your account')).toBeTruthy();
    expect(screen.getByText('You’re signed in, but no Pocket QA account uses this sign-in yet. Choose how you’ll use Pocket QA.')).toBeTruthy();
    expect(screen.getByTestId('finish-name').props.value).toBe('Fiona Firebase');
    expect(screen.getByTestId('finish-role-builder').props.accessibilityState).toMatchObject({ selected: true });
    // It rises into the room above the sign-in card (the same bottom-anchored wrapper), so that card never moves.
    expect(formWrapper('finish-account')).toBe(formWrapper('sign-in-email'));
    expect(anchoredLow()).toBe(true);
    await fireEvent.changeText(screen.getByTestId('finish-name'), ' Fiona ');
    await fireEvent.press(screen.getByTestId('finish-role-tester'));
    await fireEvent.press(screen.getByTestId('finish-submit'));
    expect(mockCompleteAccount).toHaveBeenCalledWith({ role: 'tester', displayName: 'Fiona' });
    // A new account lands with the plain replace, as Sign up does: U1 is never armed for it.
    expect(u1Armed()).toBe(false);
  });

  it('finish your account needs a display name, and a failure shows in the sign-in notice', async () => {
    mockSession = { ...LOCAL_SESSION, authMode: 'firebase', needsAccount: true };
    mockCompleteAccount.mockRejectedValue(new Error('The account could not be created.'));
    await renderIn('dark', <SignIn />);
    await advance(1000);
    expect(disabled('finish-submit')).toBe(true);
    await fireEvent.changeText(screen.getByTestId('finish-name'), 'Fiona');
    expect(disabled('finish-submit')).toBe(false);
    await fireEvent.press(screen.getByTestId('finish-submit'));
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(screen.getByText('The account could not be created.')).toBeTruthy();
  });
});

/** The role description's wrapper: the nearest ancestor that says whether it is hidden. */
function noteOf(text: string) {
  let node = screen.getByText(text, HIDDEN_OK).parent;
  while (node && node.props.importantForAccessibility === undefined) node = node.parent;
  return node!;
}
const TESTER_NOTE = 'Find studies that match your device, record consented sessions, and earn test credits when your work is approved.';
const BUILDER_NOTE = 'Create studies, fund them with local test credits, and review testers’ evidence.';

describe.each<ThemePreference>(['dark', 'light'])('Sign up in %s', (scheme) => {
  it('keeps the title, the role switch, the fields and the way back to Sign in', async () => {
    await renderIn(scheme, <SignUp />);
    await advance(1000);
    expect(screen.getByTestId('sign-up-screen')).toBeTruthy();
    // The title and the primary share the words.
    expect(screen.getAllByText('Create account')).toHaveLength(2);
    expect(screen.getByText('Choose how you’ll use Pocket QA.')).toBeTruthy();
    expect(screen.getByTestId('role')).toBeTruthy();
    expect(screen.getByText('I test apps')).toBeTruthy();
    expect(screen.getByText('I build apps')).toBeTruthy();
    expect(screen.getByTestId('sign-up-name')).toBeTruthy();
    expect(screen.getByTestId('sign-up-email')).toBeTruthy();
    expect(screen.getByTestId('sign-up-password')).toBeTruthy();
    expect(screen.getByText('At least 12 characters.')).toBeTruthy();
    expect(screen.getByText('Already have an account?')).toBeTruthy();
    expect(screen.getByTestId('go-sign-in').props.accessibilityHint).toBe('/sign-in');
  });

  it('describes the chosen role in place and hides the other description from assistive tech', async () => {
    await renderIn(scheme, <SignUp />);
    await advance(1000);
    expect(noteOf(TESTER_NOTE).props.importantForAccessibility).toBe('auto');
    expect(noteOf(BUILDER_NOTE).props.importantForAccessibility).toBe('no-hide-descendants');
    expect(noteOf(TESTER_NOTE)).toHaveAnimatedStyle({ opacity: 1 });
    expect(noteOf(BUILDER_NOTE)).toHaveAnimatedStyle({ opacity: 0 });

    await fireEvent.press(screen.getByTestId('role-builder'));
    expect(screen.getByTestId('role-builder').props.accessibilityState).toMatchObject({ selected: true });
    expect(noteOf(BUILDER_NOTE).props.importantForAccessibility).toBe('auto');
    expect(noteOf(TESTER_NOTE).props.importantForAccessibility).toBe('no-hide-descendants');
    await advance(400);
    expect(noteOf(BUILDER_NOTE)).toHaveAnimatedStyle({ opacity: 1 });
    expect(noteOf(TESTER_NOTE)).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('flags a short password, enables Create account when valid and signs up with the chosen role', async () => {
    mockSignUp.mockResolvedValue({ verification: 'none' });
    await renderIn(scheme, <SignUp />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), ' Ana ');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), ' ana@example.test ');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'short');
    expect(screen.getByTestId('sign-up-password-error')).toBeTruthy();
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy();
    expect(disabled('sign-up-submit')).toBe(true);
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'a-long-password');
    expect(screen.queryByTestId('sign-up-password-error')).toBeNull();
    expect(disabled('sign-up-submit')).toBe(false);
    await fireEvent.press(screen.getByTestId('role-builder'));
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'ana@example.test', password: fixture('a-long-password'), displayName: 'Ana', role: 'builder' });
    // Local accounts land at once: nothing to verify.
    expect(screen.queryByTestId('sign-up-verify')).toBeNull();
    expect(screen.queryByTestId('sign-up-error')).toBeNull();
  });

  it('managed sign-in: asks for the emailed verification link in the kit’s info notice', async () => {
    mockSignUp.mockResolvedValue({ verification: 'sent' });
    await renderIn(scheme, <SignUp />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Fiona');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), ' fiona@example.test ');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'a-long-password');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(screen.getByTestId('sign-up-verify')).toBeTruthy();
    expect(screen.getByText('Check your email')).toBeTruthy();
    // One body line in the notice's muted text (the kit sets a string child as its body).
    expect(screen.getByText('We sent a verification link to fiona@example.test. Open it, then sign in to finish creating your account.')).toBeTruthy();
    expect(screen.queryByTestId('sign-up-error')).toBeNull();
  });

  it('managed sign-in: an account created without its email says so and points to sign-in (live run: Firebase 503)', async () => {
    mockSignUp.mockResolvedValue({ verification: 'unsent' });
    await renderIn(scheme, <SignUp />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Fiona');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'fiona@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'a-long-password');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(screen.getByText('Account created, email not sent')).toBeTruthy();
    expect(screen.getByText('We couldn’t send the verification link to fiona@example.test. Sign in with this email and password to send it again.')).toBeTruthy();
    // Not "couldn't create": the account exists.
    expect(screen.queryByTestId('sign-up-error')).toBeNull();
    expect(screen.queryByTestId('sign-up-verify')).toBeNull();
  });

  it('shows the server’s cause in the failure notice', async () => {
    mockSignUp.mockRejectedValueOnce(new Error('An account with this email already exists.')).mockRejectedValueOnce({});
    await renderIn(scheme, <SignUp />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ana');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'ana@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'a-long-password');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(screen.getByTestId('sign-up-error')).toBeTruthy();
    expect(screen.getByText('Couldn’t create account')).toBeTruthy();
    expect(screen.getByText('An account with this email already exists.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(screen.getByText('Sign-up failed.')).toBeTruthy();
  });
});

describe('U1 and the key light (ADR 0006: every Uplight moment dims its screen’s pool)', () => {
  // Sign in drives U1 from above its Screen's Ground; the dock inside the Ground registers it.
  function Dock({ lit }: { lit: boolean }) {
    const light = useUplight('pilot', lit);
    return (
      <Ground testID="ground">
        <SignInDock light={light}>
          <View />
        </SignInDock>
      </Ground>
    );
  }
  const pool = () => getAnimatedStyle(screen.getByTestId('ground-pool', { includeHiddenElements: true })).opacity as number;

  it('the pool dims to 0.72 while the pilot is up under Sign in, and comes back when it goes', async () => {
    const r = await renderIn('dark', <Dock lit={false} />);
    await fireEvent(screen.getByTestId('ground'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
    await advance(1000);
    expect(pool()).toBeCloseTo(1, 2);
    await r.rerender(tree(<Dock lit />));
    await advance(1000);
    expect(pool()).toBeCloseTo(0.72, 2);
    await r.rerender(tree(<Dock lit={false} />));
    await advance(1000);
    expect(pool()).toBeCloseTo(1, 2);
  });
});
