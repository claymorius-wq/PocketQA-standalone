import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DemoShowcase } from '@pocket-qa/contracts';
import { LeaderboardScreen } from '../src/screens/ReputationScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';

// The labelled demo showcase on the Leaderboard (devnet demo deployment only; pqa-qa UI bar E):
// a SEPARATE section below the real ranking titled "Demo examples (not real users)", a "Demo" badge
// (a11y "Demo") on every card, no rank and no money-like numbers, no actions on demo profiles, a
// "Show demo examples" toggle persisted per viewer, and nothing at all (no request) when /config
// says the showcase is off. The real ranking never shows a demo entry.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), dismissTo: jest.fn() } }));
let mockFeatures = { testCredits: false, devnetTransfers: false, settlement: 'squads_devnet', demoShowcase: true };
const mockUser = { id: 'viewer-1', role: 'builder' };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: mockUser, features: mockFeatures }) }));
jest.mock('../src/api/client', () => ({ ApiError: class extends Error {}, api: jest.fn() }));
// Hoisted mock factories run before imports: the contract labels come in via requireActual.
const { DEMO_SHOWCASE_LABEL } = jest.requireActual<typeof import('@pocket-qa/contracts')>('@pocket-qa/contracts');
const mockBoard = {
  items: [
    { rank: 1, alias: 'Quiet Falcon', qualityScore: 91, decided: 12, badges: ['first_accepted'] },
    { rank: 2, alias: 'Calm Otter', qualityScore: 84, decided: 9, badges: [] },
  ],
  windowDays: 90,
  minDecided: 3,
};
const mockShowcase: DemoShowcase = {
  label: DEMO_SHOWCASE_LABEL,
  testers: [
    { id: 'demo-1', alias: 'Demo Ada', qualityScore: 88, decided: 14, badges: ['first_accepted'], demo: true },
    { id: 'demo-2', alias: 'Demo Bo', qualityScore: 71, decided: 6, badges: [], demo: true },
  ],
  builders: [{ id: 'demo-9', alias: 'Demo Studio North', studiesPublished: 3, demo: true }],
} as DemoShowcase;
const mockShowcaseCalls: { enabled?: boolean }[] = [];
jest.mock('../src/lib/queries', () => ({
  useReputation: () => ({ isLoading: false, error: null, data: undefined, refetch: jest.fn() }),
  useLeaderboard: () => ({ isLoading: false, error: null, data: mockBoard, refetch: jest.fn() }),
  // As React Query would: a disabled query never fetches and has no data.
  useDemoShowcase: (o: { enabled?: boolean }) => {
    mockShowcaseCalls.push(o);
    return o.enabled ? { isLoading: false, error: null, data: mockShowcase, refetch: jest.fn() } : { isLoading: false, error: null, data: undefined, refetch: jest.fn() };
  },
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const tree = (node: ReactNode) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider fonts="system">{node}</ThemeProvider>
    </QueryClientProvider>
  </SafeAreaProvider>
);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const has = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

beforeEach(async () => {
  mockFeatures = { testCredits: false, devnetTransfers: false, settlement: 'squads_devnet', demoShowcase: true };
  mockShowcaseCalls.length = 0;
  await AsyncStorage.clear();
});

describe('Leaderboard · demo showcase', () => {
  it('a separate section below the real ranking, titled exactly, every card badged "Demo"; no rank, no actions', async () => {
    await render(tree(<LeaderboardScreen />));
    await settle();
    const section = screen.getByTestId('demo-showcase');
    expect(DEMO_SHOWCASE_LABEL).toBe('Demo examples (not real users)');
    expect(within(section).getByText('Demo examples (not real users)')).toBeTruthy();
    for (const p of [...mockShowcase.testers, ...mockShowcase.builders]) {
      const card = screen.getByTestId(`demo-profile-${p.id}`);
      expect(card).toHaveTextContent(has(p.alias));
      expect(card).toHaveTextContent(/not a real user/);
      const badge = within(card).getByTestId(`demo-badge-${p.id}`);
      expect(badge.props.accessibilityLabel).toBe('Demo');
      expect(badge).toHaveTextContent(/^demo$/i);
      expect(card.props.onPress ?? card.props.onClick).toBeUndefined(); // no actions on demo profiles
      expect(card).not.toHaveTextContent(/#\d|rank/i); // never a rank
      expect(card).not.toHaveTextContent(/USDC|credits|\$|earn|paid|payout/i); // never money-like
    }
    expect(within(screen.getByTestId('demo-builders')).getByText('Demo builders')).toBeTruthy();
    expect(screen.getByTestId('demo-profile-demo-9')).toHaveTextContent(/3 studies published/);
  });

  it('the real ranking shows no demo entry; the demo section is outside it', async () => {
    await render(tree(<LeaderboardScreen />));
    await settle();
    const real = screen.getByTestId('leaderboard-list');
    expect(real).not.toHaveTextContent(/Demo/);
    expect(within(real).queryByTestId('demo-showcase')).toBeNull();
    expect(screen.getByTestId('leaderboard-row-1')).toHaveTextContent(has('Quiet Falcon'));
    expect(screen.getByTestId('leaderboard-row-2')).toHaveTextContent(has('Calm Otter'));
  });

  it('"Show demo examples" (on by default) hides and shows the examples, remembered per viewer', async () => {
    await render(tree(<LeaderboardScreen />));
    const toggle = await screen.findByTestId('demo-toggle');
    expect(toggle).toHaveTextContent(/Show demo examples/);
    expect(toggle.props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('demo-profile-demo-1')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('demo-toggle')));
    expect(screen.queryByTestId('demo-profile-demo-1')).toBeNull();
    expect(mockShowcaseCalls.at(-1)).toEqual({ enabled: false }); // hidden: not fetched
    expect(await AsyncStorage.getItem('pocketqa.demoShowcase.show.viewer-1')).toBe('0');
    await act(async () => fireEvent.press(screen.getByTestId('demo-toggle')));
    expect(await screen.findByTestId('demo-profile-demo-1')).toBeTruthy();
    expect(mockShowcaseCalls.at(-1)).toEqual({ enabled: true });
    expect(await AsyncStorage.getItem('pocketqa.demoShowcase.show.viewer-1')).toBe('1');
  });

  it('a viewer who hid the examples finds them hidden on the next visit (never flashed, not fetched)', async () => {
    await AsyncStorage.setItem('pocketqa.demoShowcase.show.viewer-1', '0');
    await render(tree(<LeaderboardScreen />));
    const toggle = await screen.findByTestId('demo-toggle');
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
    expect(screen.queryByTestId('demo-profile-demo-1')).toBeNull();
    expect(mockShowcaseCalls.every((c) => c.enabled === false)).toBe(true);
  });

  it('absent when /config says the showcase is off (production): no section, no toggle, no request', async () => {
    mockFeatures = { ...mockFeatures, demoShowcase: false };
    await render(tree(<LeaderboardScreen />));
    await settle();
    expect(screen.queryByTestId('demo-showcase')).toBeNull();
    expect(screen.queryByTestId('demo-toggle')).toBeNull();
    expect(screen.queryByText(/Demo/)).toBeNull();
    expect(mockShowcaseCalls.every((c) => c.enabled === false)).toBe(true);
  });
});
