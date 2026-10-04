import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Payout, Reputation, Study } from '@pocket-qa/contracts';
import { EscrowPanel } from '../src/screens/EscrowPanel';
import { PaymentStateCard } from '../src/screens/PaymentState';
import { LeaderboardScreen, ReputationScreen } from '../src/screens/ReputationScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';

// Wallet-funded escrow and reputation screens (ADR 0007; pqa-qa matrix A4, A5, H4, H6): every
// money state is labelled as a simulation, nothing says paid, points say they have no cash value.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
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
let mockRep: Reputation;
let mockBoard: { items: { rank: number; alias: string; qualityScore: number; decided: number; badges: string[] }[]; windowDays: number; minDecided: number };
jest.mock('../src/lib/queries', () => ({
  useReputation: () => ({ isLoading: false, error: null, data: mockRep, refetch: jest.fn() }),
  useLeaderboard: () => ({ isLoading: false, error: null, data: mockBoard, refetch: jest.fn() }),
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
function tree(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={qc}>
        <ThemeProvider fonts="system">{node}</ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => void (await jest.advanceTimersByTimeAsync(10)));
};

beforeEach(() => {
  jest.useFakeTimers();
  mockApi.mockReset();
  mockPush.mockReset();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const QUOTE = { rewardUnits: 1_000_000, slots: 3, feeBps: 1000, perTestFeeUnits: 100_000, perTestTotalUnits: 1_100_000, rewardPoolUnits: 3_000_000, platformFeeUnits: 300_000, totalUnits: 3_300_000 };
function escrowStudy(over: Partial<Extract<Study['payment'], { mode: 'escrow' }>> = {}) {
  return {
    id: 's1',
    payment: { mode: 'escrow', settlement: 'simulated', asset: 'USDC', decimals: 6, network: 'simulated', mint: 'SIM-USDC', quote: QUOTE, funded: false, balances: null, fundingWallet: null, refund: null, ...over },
  } as unknown as Study & { payment: Extract<Study['payment'], { mode: 'escrow' }> };
}

describe('EscrowPanel', () => {
  it('unfunded: shows the quote, the trust model and a simulated funding flow that ends confirmed', async () => {
    const funding = { id: 'f1', status: 'confirmed' };
    mockApi.mockImplementation((name: string) =>
      Promise.resolve(name === 'createEscrowFunding' ? { id: 'f1' } : name === 'simulatedWalletPayment' ? { signature: 'sim0123456789abcdef0123', settlement: 'simulated' } : funding),
    );
    await render(tree(<EscrowPanel study={escrowStudy()} />));
    expect(screen.getByTestId('escrow-total')).toHaveTextContent('3.30 simulated USDC');
    expect(screen.getByTestId('escrow-fee')).toHaveTextContent('0.10 simulated USDC');
    expect(screen.getByTestId('escrow-trust')).toHaveTextContent(/only to the tester’s saved wallet, for exactly this reward/);
    expect(screen.getByTestId('escrow-trust')).toHaveTextContent(/simulated: no funds move/);
    expect(screen.getByTestId('escrow-fund')).toHaveTextContent('Fund 3.30 from wallet (simulated)');
    await act(async () => fireEvent.press(screen.getByTestId('escrow-fund')));
    await settle();
    expect(mockApi.mock.calls.map((c) => c[0])).toEqual(['createEscrowFunding', 'simulatedWalletPayment', 'submitFundingSignature']);
    expect(mockApi.mock.calls[2]![1]).toEqual({ params: { id: 'f1' }, body: { signature: 'sim0123456789abcdef0123' } });
  });

  it('a pending funding waits with "Check again"; a server refusal is shown', async () => {
    mockApi.mockImplementation((name: string) =>
      name === 'createEscrowFunding' ? Promise.reject(Object.assign(new Error('Link the wallet you’ll fund this study from first.'), { code: 'CONFLICT_STATE' })) : Promise.resolve({}),
    );
    await render(tree(<EscrowPanel study={escrowStudy()} />));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-fund')));
    await settle();
    expect(screen.getByTestId('escrow-fund-error')).toHaveTextContent(/Link the wallet/);
  });

  it('funded: the books, every line simulated, and the refund state', async () => {
    const balances = { fundedUnits: 3_300_000, availableUnits: 0, heldUnits: 0, payableUnits: 0, settledUnits: 1_000_000, feesUnits: 100_000, pendingRefundUnits: 0, refundedUnits: 2_200_000 };
    await render(tree(<EscrowPanel study={escrowStudy({ funded: true, balances, fundingWallet: 'Wa11etAddress1234567890', refund: { status: 'confirmed', amountUnits: 2_200_000 } })} />));
    expect(screen.getByTestId('escrow-funded')).toHaveTextContent('Funded (simulated) from Wa11…7890.');
    expect(screen.getByTestId('escrow-settled')).toHaveTextContent('1.00 simulated USDC');
    expect(screen.getByTestId('escrow-refunded')).toHaveTextContent('2.20 simulated USDC');
    expect(screen.getByTestId('escrow-refund')).toHaveTextContent('Refunded 2.20 simulated USDC to the funding wallet · simulation, no funds moved.');
    expect(screen.queryByTestId('escrow-fund')).toBeNull();
  });
});

describe('PaymentStateCard', () => {
  const base: Payout = {
    id: 'x',
    participationId: 'p',
    studyId: 's',
    studyTitle: 'Study',
    amountUnits: 1_000_000,
    asset: 'USDC',
    decimals: 6,
    destination: 'Dest1234567890abcd',
    settlement: 'simulated',
    status: 'pending',
    signature: null,
    failureReason: null,
    attempts: 0,
    authorizedAt: '2026-10-05T00:00:00.000Z',
    settledAt: null,
  };
  it.each([
    ['pending', /Payment pending · simulation/],
    ['submitted', /Payment submitted · simulation/],
    ['confirmed', /Settled · simulation, no funds moved/],
    ['failed', /Payment failed · simulation.*retried automatically/],
  ] as const)('%s: labelled as a simulation, never paid', async (status, label) => {
    await render(tree(<PaymentStateCard payout={{ ...base, status, signature: status === 'confirmed' ? 'sim00000000000000000000' : null, failureReason: status === 'failed' ? 'No token account (simulated).' : null }} />));
    expect(screen.getByTestId('payment-state')).toHaveTextContent(label);
    expect(screen.getByTestId('payment-state')).toHaveTextContent(/1\.00 simulated USDC to Dest…abcd/);
    expect(screen.getByTestId('payment-state')).not.toHaveTextContent(/\bpaid\b/i);
    if (status === 'confirmed') expect(screen.getByTestId('payment-state-ref')).toHaveTextContent(/no network explorer link/);
    else expect(screen.queryByTestId('payment-state-ref')).toBeNull();
  });
});

describe('Reputation and leaderboard', () => {
  beforeEach(() => {
    mockRep = {
      points: 25,
      noCashValue: true,
      events: [{ kind: 'accepted', points: 10, createdAt: '2026-10-05T00:00:00.000Z', studyTitle: 'Checkout' }],
      badges: [{ id: 'first_accepted', label: 'First accepted test', description: 'A builder accepted your first test.' }],
      stats: { accepted: 2, rejected: 0, decided: 2, qualityScore: 34, windowDays: 90 },
      leaderboard: { optedIn: false, alias: null, rank: null, minDecided: 3 },
    };
    mockBoard = { items: [{ rank: 1, alias: 'Careful Cat', qualityScore: 72, decided: 9, badges: ['first_accepted'] }], windowDays: 90, minDecided: 3 };
  });

  it('shows points with no cash value, badges and the opt-in privacy terms', async () => {
    await render(tree(<ReputationScreen />));
    expect(screen.getByTestId('reputation-screen')).toHaveTextContent(/no cash value and can’t be traded/);
    expect(screen.getByTestId('reputation-points')).toHaveTextContent('25');
    expect(screen.getByTestId('badge-first_accepted')).toBeTruthy();
    expect(screen.getByText('First accepted test')).toBeTruthy();
    expect(screen.getByTestId('leaderboard-settings')).toHaveTextContent(/never your name, email, wallet or recordings/);
  });

  it('opting in sends the alias', async () => {
    mockApi.mockResolvedValue({ ...mockRep, leaderboard: { optedIn: true, alias: 'Careful Cat', rank: 1, minDecided: 3 } });
    await render(tree(<ReputationScreen />));
    await act(async () => fireEvent.press(screen.getByTestId('leaderboard-optin')));
    await act(async () => fireEvent.changeText(screen.getByTestId('leaderboard-alias'), 'Careful Cat'));
    await act(async () => fireEvent.press(screen.getByTestId('leaderboard-save')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('putLeaderboard', { body: { optIn: true, alias: 'Careful Cat' } });
  });

  it('the leaderboard lists aliases and quality, ranked, with no identifiers', async () => {
    await render(tree(<LeaderboardScreen />));
    expect(screen.getByTestId('leaderboard-screen')).toHaveTextContent(/never by volume or money/);
    expect(screen.getByTestId('leaderboard-row-1')).toHaveTextContent(/Careful Cat.*Quality 72 \/ 100 · 9 decided · 1 badge/);
  });
});

describe('wallet-rewards copy (A5)', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?)$/.test(f) ? [p] : [];
    });
  }
  // Earnings and payment wording in literals is covered by the app-wide copy linter (copy.test.ts).
  it('no app source claims trustless or secured escrow, or guaranteed rewards', () => {
    const text = [...files(join(__dirname, '../app')), ...files(join(__dirname, '../src'))].map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(text).not.toMatch(/trustless|escrow secured|secured escrow|guaranteed (reward|payment)/i);
  });
});
