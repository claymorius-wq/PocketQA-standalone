import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import { takeArrival, takeHandoff } from '../src/motion/entrance';
import StudyDetail from '../app/study/[id]';

// Study detail (A-Study): the consent flow keeps its testIDs and copy. U2 is the session's: once
// the join succeeds the session replaces this screen at once (push arrival, hand-off `u2`), and
// nothing lights here, neither while the join is pending nor after it fails.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => ({ id: 'study-1' }),
  Redirect: () => null,
}));
let mockWallet: { address: string; linkedAt: string } | null = null;
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: { id: 'u1', role: 'tester', wallet: mockWallet } }) }));
jest.mock('../src/lib/capability', () => ({ recordingCapability: () => ({ available: false, reason: 'Screen recording is unavailable on this device.' }) }));

const mockApi = jest.fn();
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, api: (...a: unknown[]) => mockApi(...a) };
});

type Study = {
  id: string;
  title: string;
  objective: string;
  rewardCredits: number;
  reward: { kind: 'test_credits'; credits: number } | { kind: 'token'; asset: 'USDC'; decimals: 6; units: number; settlement: 'simulated' };
  slotsRemaining: number;
  buildUnderTest: string | null;
  tasks: { id: string; instruction: string; successCriteria: string | null }[];
  consentVersion: number;
  consentText: string;
  myParticipationId: string | null;
};
let mockStudy: Study;
jest.mock('../src/lib/queries', () => ({
  useTesterStudy: () => ({ isLoading: false, error: null, data: mockStudy, refetch: jest.fn() }),
}));

let reduced = false;
beforeEach(() => {
  jest.useFakeTimers();
  takeArrival();
  reduced = false;
  mockReplace.mockReset();
  mockApi.mockReset();
  mockStudy = {
    id: 'study-1',
    title: 'Demo: onboarding screens',
    objective: 'Find where first-time users hesitate during sign-up.',
    rewardCredits: 30,
    reward: { kind: 'test_credits', credits: 30 },
    slotsRemaining: 5,
    buildUnderTest: 'v1.4.2 (internal)',
    tasks: [{ id: 't1', instruction: 'Create an account and reach the home screen', successCriteria: 'The receipt screen is visible' }],
    consentVersion: 1,
    consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.',
    myParticipationId: null,
  };
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduced));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

async function renderScreen(scheme: ThemePreference = 'dark') {
  let setPreference: ((p: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const result = await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">
          <Scheme>
            <StudyDetail />
          </Scheme>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await act(async () => setPreference?.(scheme));
  return result;
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

async function settle() {
  // Let the mutation settle (its promise resolves on the microtask queue).
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  // react-query batches its observer updates on a zero-delay timer.
  await act(async () => {
    jest.advanceTimersByTime(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function consentAndJoin() {
  await fireEvent.press(screen.getByTestId('consent-checkbox'));
  await fireEvent.press(screen.getByTestId('consent-submit'));
  await settle();
}

describe('Study detail', () => {
  it('keeps the study, reward, tasks, recording and consent content and testIDs', async () => {
    await renderScreen();
    expect(screen.getByTestId('study-detail-screen')).toBeTruthy();
    expect(screen.getByText('Demo: onboarding screens')).toBeTruthy();
    expect(screen.getByText('Find where first-time users hesitate during sign-up.')).toBeTruthy();
    expect(screen.getByLabelText('30 test credits')).toBeTruthy();
    expect(screen.getByText('5 slots left')).toBeTruthy();
    expect(screen.getByTestId('reward-disclaimer')).toHaveTextContent('Reward if approved · Not guaranteed. Test credits have no cash value.');
    expect(screen.getByText(/Build under test:/)).toHaveTextContent('Build under test: v1.4.2 (internal)');
    expect(screen.getByText('Create an account and reach the home screen')).toBeTruthy();
    expect(screen.getByText('Done when: The receipt screen is visible')).toBeTruthy();
    expect(screen.getByTestId('recording-unavailable')).toHaveTextContent(/Screen recording is unavailable on this device\./);
    expect(screen.getByTestId('consent-card')).toBeTruthy();
    expect(screen.getByText('Consent (version 1)')).toBeTruthy();
    expect(screen.getByTestId('consent-text')).toHaveTextContent(mockStudy.consentText);
    expect(screen.getByTestId('consent-submit')).toBeDisabled();
    expect(screen.queryByTestId('open-session')).toBeNull();
  });

  it('U2: the join is busy only while pending, then the session opens at once with the hand-off', async () => {
    let resolve: (v: { id: string }) => void = () => undefined;
    mockApi.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderScreen('dark');
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-submit'));
    await advance(1);
    expect(mockApi).toHaveBeenCalledWith('consent', { params: { id: 'study-1' }, body: { consentVersion: 1, accepted: true } });
    expect(screen.getByTestId('consent-submit')).toBeDisabled();
    expect(mockReplace).not.toHaveBeenCalled();
    resolve({ id: 'part-9' });
    await settle();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/participation/part-9');
    expect(takeHandoff('u2')).toBe(true);
  });

  it('reduced motion: the session opens as soon as the join succeeds, with the hand-off', async () => {
    reduced = true;
    mockApi.mockResolvedValue({ id: 'part-9' });
    await renderScreen('dark');
    await consentAndJoin();
    expect(mockReplace).toHaveBeenCalledWith('/participation/part-9');
    expect(takeHandoff('u2')).toBe(true);
  });

  it('light theme: the session opens as soon as the join succeeds, with the hand-off', async () => {
    mockApi.mockResolvedValue({ id: 'part-9' });
    await renderScreen('light');
    await consentAndJoin();
    expect(mockReplace).toHaveBeenCalledWith('/participation/part-9');
    expect(takeHandoff('u2')).toBe(true);
  });

  it('a failed join shows the error, stays unlit and does not navigate', async () => {
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockRejectedValue(new ApiError('STUDY_FULL', 'This study is full.'));
    await renderScreen('dark');
    await consentAndJoin();
    expect(screen.getByTestId('consent-error')).toHaveTextContent(/Couldn’t join/);
    expect(screen.getByTestId('consent-error')).toHaveTextContent(/This study is full\./);
    await advance(2000);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(takeHandoff('u2')).toBe(false);
    expect(screen.getByTestId('consent-submit')).not.toBeDisabled();
  });

  it('wallet-funded study: the reward is simulated USDC, and joining needs the explicit wallet confirmation', async () => {
    mockWallet = { address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', linkedAt: '2026-10-05T00:00:00.000Z' };
    mockStudy = { ...mockStudy, rewardCredits: 0, reward: { kind: 'token', asset: 'USDC', decimals: 6, units: 1_500_000, settlement: 'simulated' } };
    mockApi.mockReturnValue(new Promise(() => {}));
    try {
      await renderScreen();
      expect(screen.getByTestId('reward-disclaimer')).toHaveTextContent(/Simulation in this build: no funds move/);
      await fireEvent.press(screen.getByTestId('consent-checkbox'));
      expect(screen.getByTestId('consent-submit')).toBeDisabled();
      expect(screen.getByText(/only to my wallet 7EcD…FLtV\. It can’t be changed after I join\./, { includeHiddenElements: true })).toBeTruthy();
      await fireEvent.press(screen.getByTestId('consent-reward-wallet'));
      await fireEvent.press(screen.getByTestId('consent-submit'));
      expect(mockApi).toHaveBeenCalledWith('consent', { params: { id: 'study-1' }, body: { consentVersion: 1, accepted: true, payoutAddress: mockWallet.address } });
    } finally {
      mockWallet = null;
    }
  });

  it('wallet-funded study without a linked wallet: asks to link one, and joining stays off', async () => {
    mockStudy = { ...mockStudy, rewardCredits: 0, reward: { kind: 'token', asset: 'USDC', decimals: 6, units: 1_000_000, settlement: 'simulated' } };
    await renderScreen();
    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(screen.getByTestId('consent-needs-wallet')).toBeTruthy();
    expect(screen.getByTestId('consent-submit')).toBeDisabled();
  });

  it('a joined study offers "Open your session" instead of the consent card', async () => {
    mockStudy = { ...mockStudy, myParticipationId: 'part-3' };
    await renderScreen();
    expect(screen.queryByTestId('consent-card')).toBeNull();
    await fireEvent.press(screen.getByTestId('open-session'));
    expect(mockReplace).toHaveBeenCalledWith('/participation/part-3');
  });
});
