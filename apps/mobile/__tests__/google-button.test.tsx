import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GOOGLE_G_SVG, GOOGLE_G_SVG_SHA256 } from '../src/auth/googleG';
import { disarmU1 } from '../src/screens/authParts';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { touch } from '../src/theme/tokens';
import { GOOGLE_THEME, GoogleButton } from '../src/ui/patterns/GoogleButton';
import SignIn from '../app/(auth)/sign-in';
import SignUp from '../app/(auth)/sign-up';

// The branded Google button: the official G (byte-identical to Google's asset, never redrawn or
// recolored), an approved label, the kit's full-width button states, and on Sign up the same
// Google sign-in as Sign in (a new identity finishes its account on Sign in). Behavior and role
// routing are unchanged: Sign in still calls signInWithGoogle, offered only where it is enabled.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children, href, testID }: { children: ReactNode; href: string; testID?: string }) => createElement(Text, { testID, accessibilityRole: 'link', accessibilityHint: href }, children),
    router: { replace: (...a: unknown[]) => mockReplace(...a) },
  };
});
jest.mock('../src/preview/demoAccounts', () => ({ PREVIEW_BUILD: false, loadDemoAccounts: async () => [] }));
jest.mock('../src/wallet/useWallets', () => ({ useWallets: () => [] }));

const mockGoogle = jest.fn<Promise<void>, []>();
const BASE = {
  authMode: 'firebase',
  storage: 'r2',
  walletLogin: false,
  googleSignIn: true,
  needsAccount: false,
  signedInEmail: null,
  pendingProfile: null,
  features: { testCredits: true, devnetTransfers: false, settlement: 'off' },
  unverifiedEmail: false,
  unreachable: false,
};
let mockSession: Record<string, unknown> = { ...BASE };
jest.mock('../src/auth/SessionProvider', () => ({
  useSession: () => ({
    ...mockSession,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signInWithGoogle: mockGoogle,
    signInWithWallet: jest.fn(),
    completeAccount: jest.fn(),
    signOut: jest.fn(),
    retryConnection: () => {},
    resendVerification: async () => {},
    discardUnverified: async () => {},
    sendPasswordReset: async () => {},
  }),
}));

/** The G is aria-hidden, so queries that look for it must include hidden elements. */
const HIDDEN = { includeHiddenElements: true } as const;

function wrap(ui: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.replaceProperty(Platform, 'OS', 'web');
  mockSession = { ...BASE };
  mockGoogle.mockReset().mockResolvedValue(undefined);
  mockReplace.mockReset();
  disarmU1();
});
afterEach(() => jest.restoreAllMocks());

describe('the official Google G', () => {
  test('both theme assets are byte-identical to Google’s (pinned sha256)', () => {
    for (const t of ['light', 'dark'] as const) {
      expect(createHash('sha256').update(GOOGLE_G_SVG[t], 'utf8').digest('hex')).toBe(GOOGLE_G_SVG_SHA256[t]);
    }
    expect(GOOGLE_G_SVG_SHA256).toEqual({
      light: '6587b180203a99da15c0a041018e15c94ffd9556c4b9855bdc69806081a93791',
      dark: '2f7ecc307b1db0f1738456269ee2c4433b3a73c35060ced67a9afcfc6821e786',
    });
  });

  test('each asset’s fill is its theme’s button fill (the G sits on the approved surface)', () => {
    expect(GOOGLE_G_SVG.light).toContain('fill="white"');
    expect(GOOGLE_G_SVG.dark).toContain('fill="#131314"');
    for (const t of ['light', 'dark'] as const) expect(GOOGLE_G_SVG[t]).toContain('conic-gradient');
  });

  test('the button theme is Google’s approved light and dark, exactly', () => {
    expect(GOOGLE_THEME).toEqual({
      light: { fill: '#FFFFFF', stroke: '#747775', text: '#1F1F1F' },
      dark: { fill: '#131314', stroke: '#8E918F', text: '#E3E3E3' },
    });
  });
});

describe('GoogleButton', () => {
  test('renders the G and an approved label as one accessible button', async () => {
    const onPress = jest.fn();
    await render(wrap(<GoogleButton intent="continue" onPress={onPress} testID="g" />));
    await act(async () => {});
    const button = screen.getByTestId('g');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Continue with Google');
    // Google's light theme (the test theme is light): the exact fill and stroke.
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ backgroundColor: '#FFFFFF', borderColor: '#747775', borderWidth: 1 });
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    // The G is decoration, hidden from assistive tech: the label alone names the button.
    expect(screen.getByTestId('g-logo', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('g-logo')).toBeNull();
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('"Sign up with Google" is the sign-up wording', async () => {
    await render(wrap(<GoogleButton intent="signUp" onPress={() => {}} testID="g" />));
    await act(async () => {});
    expect(screen.getByText('Sign up with Google')).toBeTruthy();
  });

  test('busy: announced busy, the spinner replaces the G, presses ignored', async () => {
    const onPress = jest.fn();
    await render(wrap(<GoogleButton intent="continue" onPress={onPress} loading testID="g" />));
    await act(async () => {});
    const button = screen.getByTestId('g');
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.queryByTestId('g-logo', HIDDEN)).toBeNull();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test('disabled: announced disabled, presses ignored, the G is kept (never recolored)', async () => {
    const onPress = jest.fn();
    await render(wrap(<GoogleButton intent="continue" onPress={onPress} disabled testID="g" />));
    await act(async () => {});
    expect(screen.getByTestId('g').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('g-logo', HIDDEN)).toBeTruthy();
    fireEvent.press(screen.getByTestId('g'));
    expect(onPress).not.toHaveBeenCalled();
  });

  test('meets the touch minimum (≥ 44)', () => {
    expect(touch.button).toBeGreaterThanOrEqual(44);
  });
});

describe('Sign in', () => {
  test('the Google button is the branded one and still calls signInWithGoogle', async () => {
    await render(wrap(<SignIn />));
    await act(async () => {});
    expect(screen.getByTestId('sign-in-google-logo', HIDDEN)).toBeTruthy();
    // Out of the form card, under an "or" divider, full width like Sign in (QA B3/B4).
    expect(screen.getByTestId('sign-in-or', HIDDEN)).toBeTruthy();
    expect(within(screen.getByTestId('sign-in-others')).getByTestId('sign-in-google')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sign-in-google'));
    });
    expect(mockGoogle).toHaveBeenCalledTimes(1);
  });
});

describe('Sign up', () => {
  test('offers "Sign up with Google" only on web with Firebase and Google enabled', async () => {
    for (const [patch, offered] of [
      [{}, true],
      [{ googleSignIn: false }, false],
      [{ authMode: 'local' }, false],
    ] as const) {
      mockSession = { ...BASE, ...patch };
      const view = await render(wrap(<SignUp />));
      await act(async () => {});
      expect(!!screen.queryByTestId('sign-up-google')).toBe(offered);
      await view.unmount();
    }
    jest.replaceProperty(Platform, 'OS', 'android');
    mockSession = { ...BASE };
    await render(wrap(<SignUp />));
    await act(async () => {});
    expect(screen.queryByTestId('sign-up-google')).toBeNull();
  });

  test('runs the same Google sign-in, then goes to Sign in (where a new identity finishes its account)', async () => {
    await render(wrap(<SignUp />));
    await act(async () => {});
    expect(screen.getByText('Sign up with Google')).toBeTruthy();
    expect(screen.getByTestId('sign-up-google-logo', HIDDEN)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sign-up-google'));
    });
    expect(mockGoogle).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
  });

  test('a failed Google sign-in stays on Sign up and shows why', async () => {
    mockGoogle.mockRejectedValueOnce(new Error('Google sign-in was closed before it finished.'));
    await render(wrap(<SignUp />));
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByTestId('sign-up-google'));
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-up-error')).toBeTruthy();
    expect(screen.getByText('Google sign-in was closed before it finished.')).toBeTruthy();
  });
});

describe('busy while the Google popup is open (QA r2 P2-G2)', () => {
  for (const [name, Screen, id] of [
    ['Sign in', SignIn, 'sign-in-google'],
    ['Sign up', SignUp, 'sign-up-google'],
  ] as const) {
    test(`${name}: spinner + aria-busy until Google answers, then idle again`, async () => {
      let answer: () => void = () => {};
      mockGoogle.mockReturnValueOnce(new Promise<void>((r) => (answer = r)));
      await render(wrap(<Screen />));
      await act(async () => {});
      await act(async () => {
        fireEvent.press(screen.getByTestId(id));
      });
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ busy: true });
      expect(screen.queryByTestId(`${id}-logo`, HIDDEN)).toBeNull();
      // A second press while it is open opens nothing more.
      fireEvent.press(screen.getByTestId(id));
      expect(mockGoogle).toHaveBeenCalledTimes(1);
      await act(async () => answer());
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ busy: false });
    });
  }

  test('Sign up has the "or" rule above its Google button', async () => {
    await render(wrap(<SignUp />));
    await act(async () => {});
    expect(screen.getByTestId('sign-up-or', HIDDEN)).toBeTruthy();
  });
});
