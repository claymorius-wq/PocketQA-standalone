import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { CreditsScreen, resetShownEarnings, ROW_LANDS_AFTER, unseenEarnings } from '../CreditsScreen';

// Credits / Budget (A-Credits, A-Budget): the balance leads, the builder's top-up card, the ledger
// in one card, S5 (the row lands after the roll) and U5 (tester only, Earned on the balance).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type Entry = { id: string; kind: string; amount: number; studyId: string | null; participationId: string | null; createdAt: string };
type Data = { balance: number; entries: Entry[]; disclaimer: 'Test credits · no cash value' };
let mockUser: { id: string; role: 'tester' | 'builder' } = { id: 'u-tester', role: 'tester' };
let mockFeatures = { testCredits: true, devnetTransfers: true, settlement: 'off' };
let mockData: Data = { balance: 0, entries: [], disclaimer: 'Test credits · no cash value' };
const mockApi = jest.fn();
jest.mock('../../auth/SessionProvider', () => ({ useSession: () => ({ user: mockUser, features: mockFeatures }) }));
jest.mock('../../lib/queries', () => ({
  useCredits: () => ({ isLoading: false, error: null, data: mockData, refetch: jest.fn() }),
  useMyPayouts: () => ({ isLoading: false, error: null, data: { items: [] }, refetch: jest.fn() }),
  useFocusRefetch: () => undefined,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../api/client', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, api: (...args: unknown[]) => mockApi(...args) };
});
// Records what the screen asks of the balance (earned, seen, play).
const mockHero: { balance: number; earned?: boolean; seen?: boolean; play?: boolean }[] = [];
jest.mock('../../ui/patterns', () => {
  const actual = jest.requireActual('../../ui/patterns');
  return {
    ...actual,
    BalanceHero: (props: { balance: number; earned?: boolean; seen?: boolean; play?: boolean }) => {
      mockHero.push(props);
      return actual.BalanceHero(props);
    },
  };
});

const entry = (id: string, kind: string, amount: number, createdAt = '2026-10-03T16:40:00.000Z'): Entry => ({ id, kind, amount, studyId: null, participationId: null, createdAt });
const lastHero = () => mockHero[mockHero.length - 1]!;

beforeEach(() => {
  jest.useFakeTimers();
  mockHero.length = 0;
  mockApi.mockReset();
  resetShownEarnings();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
let setPreference: ((p: ThemePreference) => void) | undefined;
function Scheme({ children }: { children: ReactNode }) {
  setPreference = useTheme().setPreference;
  return <>{children}</>;
}
let client = new QueryClient();
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
const wrap = (title: string) => (
  <QueryClientProvider client={client}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Scheme>
          <CreditsScreen title={title} />
        </Scheme>
      </ThemeProvider>
    </SafeAreaProvider>
  </QueryClientProvider>
);
async function renderScreen(title: string) {
  const r = await render(wrap(title));
  await act(async () => setPreference?.('dark'));
  return r;
}
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('unseenEarnings', () => {
  it('counts only earned credit (approvals, overturned disputes) not shown yet', () => {
    const list = [entry('a', 'reward_credit', 50), entry('b', 'dispute_credit', 50), entry('c', 'test_topup', 1000), entry('d', 'study_release', 20)];
    expect(unseenEarnings(list, new Set()).map((e) => e.id)).toEqual(['a', 'b']);
    expect(unseenEarnings(list, new Set(['a'])).map((e) => e.id)).toEqual(['b']);
  });
});

describe('Credits (tester)', () => {
  beforeEach(() => {
    mockUser = { id: 'u-tester', role: 'tester' };
    mockData = { balance: 0, entries: [], disclaimer: 'Test credits · no cash value' };
  });

  it('a new tester: the balance leads, History holds the empty row, nothing is lit, no top-up', async () => {
    await renderScreen('Credits');
    expect(screen.getByTestId('credits-screen')).toBeTruthy();
    expect(screen.getByTestId('balance-card')).toBeTruthy();
    expect(screen.getByTestId('credit-balance')).toHaveTextContent('0 test credits');
    expect(screen.getByText('Test credits · no cash value. Credits can’t be withdrawn or exchanged.')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No activity yet')).toBeTruthy();
    expect(screen.getByText('Credits appear here when a builder approves your work.')).toBeTruthy();
    expect(screen.queryByTestId('topup-submit')).toBeNull();
    expect(lastHero()).toMatchObject({ earned: false, seen: false, play: true });
  });

  it('approved credit lands in view: U5 rises, and the row lands 600ms after the roll starts', async () => {
    const r = await renderScreen('Credits');
    mockData = { balance: 50, entries: [entry('r1', 'reward_credit', 50)], disclaimer: 'Test credits · no cash value' };
    await r.rerender(wrap('Credits'));
    await advance(1);
    expect(lastHero()).toMatchObject({ balance: 50, earned: true, seen: false });
    // The roll has started; the ledger still shows the empty row until +600.
    expect(screen.queryByTestId('ledger-reward_credit')).toBeNull();
    await advance(ROW_LANDS_AFTER);
    expect(screen.getByTestId('ledger-reward_credit')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(screen.getByText('Approved work')).toBeTruthy();
    expect(screen.getByLabelText('plus 50 test credits')).toHaveTextContent('+50');
    await advance(2000);
    expect(screen.getByTestId('credit-balance')).toHaveTextContent('50 test credits');
  });

  it('opening on approved credit not shown yet renders U5 at rest; a later visit is unlit', async () => {
    mockData = {
      balance: 100,
      entries: [entry('d1', 'dispute_credit', 50, '2026-10-02T11:05:00.000Z'), entry('r1', 'reward_credit', 50)],
      disclaimer: 'Test credits · no cash value',
    };
    const r = await renderScreen('Credits');
    expect(lastHero()).toMatchObject({ earned: true, seen: true });
    expect(screen.getByTestId('ledger-reward_credit')).toBeTruthy();
    expect(screen.getByTestId('ledger-dispute_credit')).toBeTruthy();
    expect(screen.getByText('Dispute overturned')).toBeTruthy();
    await r.unmount();
    mockHero.length = 0;
    await renderScreen('Credits');
    expect(lastHero()).toMatchObject({ earned: false });
  });
});

describe('Budget (builder)', () => {
  beforeEach(() => {
    mockUser = { id: 'u-builder', role: 'builder' };
    mockData = {
      balance: 600,
      entries: [entry('s2', 'study_reserve', -150), entry('s1', 'study_reserve', -250), entry('t1', 'test_topup', 1000)],
      disclaimer: 'Test credits · no cash value',
    };
  });

  it('balance, the top-up card and the ledger; top-up posts the chosen amount and is never lit', async () => {
    mockApi.mockResolvedValue({ balance: 5600 });
    await renderScreen('Budget');
    expect(screen.getByTestId('credit-balance')).toHaveTextContent('600 test credits');
    expect(screen.getByText('Add local test credits')).toBeTruthy();
    expect(screen.getByText('Fund studies in this local build. No money changes hands.')).toBeTruthy();
    expect(screen.getAllByTestId('ledger-study_reserve')).toHaveLength(2);
    expect(screen.getByTestId('ledger-test_topup')).toBeTruthy();
    expect(screen.getByLabelText('minus 250 test credits')).toHaveTextContent('−250');
    expect(screen.getByLabelText('plus 1,000 test credits')).toHaveTextContent('+1,000');
    expect(screen.queryByTestId('empty-state')).toBeNull();

    await fireEvent.press(screen.getByTestId('topup-amount-5000'));
    await fireEvent.press(screen.getByTestId('topup-submit'));
    expect(mockApi).toHaveBeenCalledWith('topUp', { body: { amount: 5000 }, idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(mockHero.every((p) => !p.earned)).toBe(true);
  });

  it('a pending top-up sends the amount that was tapped; picking another meanwhile is ignored (Lens follow-ups P3-6)', async () => {
    let finish: (v: unknown) => void = () => {};
    mockApi.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await renderScreen('Budget');
    await fireEvent.press(screen.getByTestId('topup-amount-500'));
    await fireEvent.press(screen.getByTestId('topup-submit'));
    await fireEvent.press(screen.getByTestId('topup-amount-5000'));
    // The control keeps showing what is being sent while the request runs.
    expect(screen.getByTestId('topup-amount-500')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('topup-amount-5000')).toHaveProp('accessibilityState', { selected: false });
    await act(async () => finish({ balance: 500 }));
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith('topUp', { body: { amount: 500 }, idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) });
    mockApi.mockReset();
  });

  it('production (no test credits): an honest funding notice, no top-up card and no top-up call (ledger D3)', async () => {
    mockFeatures = { testCredits: false, devnetTransfers: false, settlement: 'off' };
    try {
      await renderScreen('Budget');
      expect(screen.getByTestId('funding-unavailable')).toHaveTextContent(/paying with real money isn’t enabled yet/);
      expect(screen.queryByTestId('topup-submit')).toBeNull();
      expect(screen.queryByText('Add local test credits')).toBeNull();
      expect(mockApi).not.toHaveBeenCalledWith('topUp', expect.anything());
    } finally {
      mockFeatures = { testCredits: true, devnetTransfers: true, settlement: 'off' };
    }
  });

  it('an empty ledger shows the builder copy; a failed top-up shows the danger notice', async () => {
    mockData = { balance: 0, entries: [], disclaimer: 'Test credits · no cash value' };
    const { ApiError } = jest.requireMock('../../api/client') as { ApiError: new (code: string, message: string) => Error };
    mockApi.mockRejectedValue(new ApiError('VALIDATION', 'Test credit top-ups must be whole numbers from 1 to 10000.'));
    await renderScreen('Budget');
    expect(screen.getByText('Top-ups, study reserves and releases appear here.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('topup-submit'));
    await advance(1);
    expect(screen.getByText('Top-up failed')).toBeTruthy();
    expect(screen.getByText('Test credit top-ups must be whole numbers from 1 to 10000.')).toBeTruthy();
  });
});
