import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { RoleTabs } from '../src/screens/TabsLayout';

// Native regression (merged Lens build, 2026-10-04): signing out, including after account
// deletion, crashed Android with "Maximum update depth exceeded" in the root NativeStackNavigator.
// The root layout swapped its Stack for <Redirect href="/sign-in"> while the role tabs redirected
// to "/" at the same time, and expo-router's state sync looped. Now one guard per route, one target.

jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Tabs: Object.assign(() => createElement(View, { testID: 'tabs' }), { Screen: () => null }),
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
  };
});
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockUser: { id: string; role: string } | null = null;
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ ready: true, user: mockUser }) }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const tabs = (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider>
      <RoleTabs role="tester" tabs={[]} />
    </ThemeProvider>
  </SafeAreaProvider>
);

it('a signed-out user in the role tabs goes straight to /sign-in (the one sign-out target)', async () => {
  mockUser = null;
  await render(tabs);
  expect(screen.getByTestId('redirect')).toHaveTextContent('/sign-in');
});

it('a user of another role still goes to their own home', async () => {
  mockUser = { id: 'b1', role: 'builder' };
  await render(tabs);
  expect(screen.getByTestId('redirect')).toHaveTextContent('/');
});

it('the root layout never swaps its navigator for a redirect', () => {
  const code = readFileSync(join(__dirname, '../app/_layout.tsx'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  expect(code).not.toMatch(/<Redirect\b/);
  expect(code).not.toMatch(/from 'expo-router'.*\bRedirect\b|\bRedirect\b.*from 'expo-router'/);
});
