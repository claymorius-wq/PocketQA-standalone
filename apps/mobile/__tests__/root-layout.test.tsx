import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import RootLayout from '../app/_layout';
import { readIntroSeen } from '../src/onboarding/intro';

// The root layout: anyone with a session has seen the intro, whichever route they open first (a
// deep link never passes through "/"), so they never meet it after signing out.

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Stack: Object.assign(() => createElement(View, { testID: 'root-stack' }), { Screen: () => null }),
    SplashScreen: { preventAutoHideAsync: () => Promise.resolve(), hideAsync: () => Promise.resolve() },
  };
});
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockUser: { id: string; role: string } | null = null;
jest.mock('../src/auth/SessionProvider', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({ ready: true, user: mockUser, features: { testCredits: true } }),
}));

beforeEach(async () => {
  mockUser = null;
  await AsyncStorage.clear();
});

it('marks the intro seen once there is a session, and not before', async () => {
  await render(<RootLayout />);
  expect(screen.getByTestId('root-stack')).toBeTruthy();
  await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(await readIntroSeen()).toBe(false);
  mockUser = { id: 't1', role: 'tester' };
  await render(<RootLayout />);
  await waitFor(async () => expect(await readIntroSeen()).toBe(true));
});
