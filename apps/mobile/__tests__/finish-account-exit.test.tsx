import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { disarmU1 } from '../src/screens/authParts';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import SignIn from '../app/(auth)/sign-in';

// QA P2 (qa-google-signout-r1 §5): "Finish your account" must have a way out. Someone signed in
// with the wrong Google or email identity must be able to sign out of the app and go back to the
// sign-in form, instead of being pushed into creating a new, empty account (which is how a
// returning user could miss their existing, migrated account). And Google is offered only where
// the deployment enables it (/config firebase.googleSignIn).

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
jest.mock('../src/preview/demoAccounts', () => ({ PREVIEW_BUILD: false, loadDemoAccounts: async () => [] }));
jest.mock('../src/wallet/useWallets', () => ({ useWallets: () => [] }));

const mockSignOut = jest.fn<Promise<void>, []>();
const mockCompleteAccount = jest.fn();
/** A managed (Firebase) sign-in that no Pocket QA account uses yet. */
const NEEDS_ACCOUNT = {
  authMode: 'firebase',
  storage: 'r2',
  walletLogin: false,
  googleSignIn: false,
  needsAccount: true,
  signedInEmail: 'other.person@example.test' as string | null,
  pendingProfile: null,
  features: { testCredits: true, devnetTransfers: false, settlement: 'off' },
  unverifiedEmail: false,
  unreachable: false,
};
let mockSession: Record<string, unknown> = { ...NEEDS_ACCOUNT };
jest.mock('../src/auth/SessionProvider', () => ({
  useSession: () => ({
    ...mockSession,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signInWithGoogle: jest.fn(),
    signInWithWallet: jest.fn(),
    completeAccount: mockCompleteAccount,
    signOut: mockSignOut,
    retryConnection: () => {},
    resendVerification: async () => {},
    discardUnverified: async () => {},
    sendPasswordReset: async () => {},
  }),
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const tree = (node: ReactNode) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">{node}</ThemeProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.useFakeTimers();
  mockSession = { ...NEEDS_ACCOUNT };
  mockSignOut.mockReset().mockImplementation(async () => {
    // The session after signOut: nobody signed in, nothing to finish.
    mockSession = { ...mockSession, needsAccount: false, signedInEmail: null };
  });
  mockCompleteAccount.mockReset();
  disarmU1();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(true));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function renderSignIn() {
  const r = await render(tree(<SignIn />));
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  return r;
}

describe('Finish your account: a way out', () => {
  it('names the signed-in email and tells a returning user to sign in with the email their account uses', async () => {
    await renderSignIn();
    const card = screen.getByTestId('finish-account');
    expect(card).toBeTruthy();
    expect(screen.getByText('No Pocket QA account uses other.person@example.test yet. If you already have an account, sign in with the email it uses.')).toBeTruthy();
  });

  it('without an email on the identity, it says "this sign-in"', async () => {
    mockSession = { ...NEEDS_ACCOUNT, signedInEmail: null };
    await renderSignIn();
    expect(screen.getByText('No Pocket QA account uses this sign-in yet. If you already have an account, sign in with the email it uses.')).toBeTruthy();
  });

  it('offers "Use another account", which signs out of the app and returns to the sign-in form', async () => {
    const r = await renderSignIn();
    const exit = screen.getByTestId('finish-sign-out');
    expect(exit).toBeTruthy();
    expect(screen.getByText('Use another account')).toBeTruthy();
    await act(async () => fireEvent.press(exit));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockCompleteAccount).not.toHaveBeenCalled();
    // The real SessionProvider re-renders its consumers when signOut clears the session; the mock
    // session is a plain object, so re-render as that context update would.
    await r.rerender(tree(<SignIn />));
    // Back on the plain sign-in form: no Finish card, the fields are there to sign in again.
    expect(screen.queryByTestId('finish-account')).toBeNull();
    expect(screen.getByTestId('sign-in-email')).toBeTruthy();
    expect(screen.getByTestId('sign-in-password')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-error')).toBeNull();
  });

  it('creating the account is still available and is not the only choice', async () => {
    await renderSignIn();
    expect(screen.getByTestId('finish-submit')).toBeTruthy();
    expect(screen.getByTestId('finish-sign-out')).toBeTruthy();
  });
});

describe('Google sign-in only where the deployment enables it', () => {
  it.each([
    [true, true],
    [false, false],
  ])('web, firebase, googleSignIn=%s: Google offered = %s', async (googleSignIn, offered) => {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockSession = { ...NEEDS_ACCOUNT, needsAccount: false, signedInEmail: null, googleSignIn };
    await renderSignIn();
    expect(!!screen.queryByTestId('sign-in-google')).toBe(offered);
  });
});
