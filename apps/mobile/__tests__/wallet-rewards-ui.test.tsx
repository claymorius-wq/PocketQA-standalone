import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Linking } from 'react-native';
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
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), dismissTo: (...a: unknown[]) => mockDismissTo(...a) } }));
let mockUser = { id: 'tester-1', role: 'tester' };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: mockUser }) }));
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
let mockRepError: Error | null = null;
const mockRepOptions: unknown[] = [];
let mockBoard: { items: { rank: number; alias: string; qualityScore: number; decided: number; badges: string[] }[]; windowDays: number; minDecided: number };
let mockBoardError: Error | null = null;
jest.mock('../src/lib/queries', () => ({
  // As React Query would with an empty cache (sign-out clears it): a disabled query never fetches
  // and has no data.
  useReputation: (options?: { enabled?: boolean }) => {
    mockRepOptions.push(options);
    return options?.enabled === false ? { isLoading: false, error: null, data: undefined, refetch: jest.fn() } : { isLoading: false, error: mockRepError, data: mockRep, refetch: jest.fn() };
  },
  useLeaderboard: () => ({ isLoading: false, error: mockBoardError, data: mockBoard, refetch: jest.fn() }),
  // The demo showcase is off here (no features in this session mock): never fetched.
  useDemoShowcase: () => ({ isLoading: false, error: null, data: undefined, refetch: jest.fn() }),
}));

/** Whether a host view above `node` is one accessibility element (VoiceOver never visits inside one). */
type HostNode = { type: unknown; props: Record<string, unknown>; parent: HostNode | null };
function insideAccessibleView(node: HostNode): boolean {
  for (let p = node.parent; p; p = p.parent) if (typeof p.type === 'string' && p.props.accessible === true) return true;
  return false;
}

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
    await render(tree(<EscrowPanel study={escrowStudy({ funded: true, balances, fundingWallet: 'Wa11etAddress1234567890', refund: { settlementId: 'refund-1', status: 'confirmed', amountUnits: 2_200_000 } })} />));
    expect(screen.getByTestId('escrow-funded')).toHaveTextContent('Funded (simulated) from Wa11…7890.');
    expect(screen.getByTestId('escrow-settled')).toHaveTextContent('1.00 simulated USDC');
    expect(screen.getByTestId('escrow-refunded')).toHaveTextContent('2.20 simulated USDC');
    expect(screen.getByTestId('escrow-refund')).toHaveTextContent('Refunded 2.20 simulated USDC to the funding wallet · simulation, no funds moved.');
    expect(screen.queryByTestId('escrow-fund')).toBeNull();
  });
});

describe('EscrowPanel · Squads devnet pilot', () => {
  const pilot = (over: Partial<Extract<Study['payment'], { mode: 'escrow' }>> = {}) =>
    escrowStudy({ settlement: 'squads_devnet', network: 'solana:devnet', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', ...over });

  it('labels every amount as devnet test USDC with the pilot disclosure; never simulated, paid or trustless', async () => {
    await render(tree(<EscrowPanel study={pilot()} />));
    expect(screen.getByTestId('escrow-total')).toHaveTextContent('3.30 devnet test USDC');
    expect(screen.getByTestId('escrow-trust')).toHaveTextContent(/two of three signers/);
    expect(screen.getByTestId('escrow-trust')).toHaveTextContent(/Devnet test USDC, no value\. Pilot: test keys simulate all roles/);
    expect(screen.getByTestId('escrow-trust')).toHaveTextContent(/not independent custody/);
    expect(screen.getByTestId('escrow-panel')).not.toHaveTextContent(/simulation|simulated|\bpaid\b|trustless/i);
    expect(screen.getByTestId('escrow-fund')).toHaveTextContent('Fund 3.30 devnet test USDC from wallet');
  });

  it('funding: shows the exact amount, vault and reference, then verifies the pasted signature (no stand-in wallet)', async () => {
    const request = { id: 'f1', status: 'awaiting_payment', amountUnits: 3_300_000, vault: 'VaultAta1111111111111111111111111111111111', reference: 'Ref11111111111111111111111111111111111111111', failureReason: null };
    mockApi.mockImplementation((name: string) => Promise.resolve(name === 'createEscrowFunding' ? request : { ...request, status: 'confirmed' }));
    await render(tree(<EscrowPanel study={pilot()} />));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-fund')));
    await settle();
    expect(screen.getByTestId('escrow-pilot-amount')).toHaveTextContent('3.30 devnet test USDC');
    expect(screen.getByTestId('escrow-pilot-vault')).toHaveTextContent(request.vault);
    expect(screen.getByTestId('escrow-pilot-reference')).toHaveTextContent(request.reference);
    await act(async () => fireEvent.changeText(screen.getByTestId('escrow-pilot-signature'), '  5sig  '));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-pilot-verify')));
    await settle();
    expect(mockApi.mock.calls.map((c) => c[0])).toEqual(['createEscrowFunding', 'submitFundingSignature']);
    expect(mockApi.mock.calls[1]![1]).toEqual({ params: { id: 'f1' }, body: { signature: '5sig' } });
  });

  it('funded: the books and refund say devnet', async () => {
    const balances = { fundedUnits: 3_300_000, availableUnits: 0, heldUnits: 0, payableUnits: 0, settledUnits: 2_000_000, feesUnits: 200_000, pendingRefundUnits: 0, refundedUnits: 1_100_000 };
    await render(tree(<EscrowPanel study={pilot({ funded: true, balances, fundingWallet: 'Wa11etAddress1234567890', refund: { settlementId: 'refund-1', status: 'confirmed', amountUnits: 1_100_000 } })} />));
    expect(screen.getByTestId('escrow-funded')).toHaveTextContent('Funded on devnet from Wa11…7890.');
    expect(screen.getByTestId('escrow-settled')).toHaveTextContent('2.00 devnet test USDC');
    expect(screen.getByTestId('escrow-refund')).toHaveTextContent('Refunded 1.10 devnet test USDC to the funding wallet · finalized on devnet, no value.');
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

describe('PaymentStateCard · Squads devnet pilot', () => {
  it('a settled devnet payout links to the devnet explorer and says no value', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const payout = { id: 'x', participationId: 'p', studyId: 's', studyTitle: 'Study', amountUnits: 1_000_000, asset: 'USDC', decimals: 6, destination: 'Dest1234567890abcd', settlement: 'squads_devnet', status: 'confirmed', signature: '5SigAbcdefghijklmnop', failureReason: null, attempts: 1, authorizedAt: '2026-10-05T00:00:00.000Z', settledAt: '2026-10-05T00:01:00.000Z' } as Payout;
    await render(tree(<PaymentStateCard payout={payout} />));
    expect(screen.getByTestId('payment-state')).toHaveTextContent(/Settled on devnet · test USDC, no value/);
    expect(screen.getByTestId('payment-state')).toHaveTextContent(/1\.00 devnet test USDC to Dest…abcd/);
    expect(screen.getByTestId('payment-state')).not.toHaveTextContent(/\bpaid\b/i);
    await act(async () => fireEvent.press(screen.getByTestId('payment-state-explorer')));
    expect(openURL).toHaveBeenCalledWith('https://explorer.solana.com/tx/5SigAbcdefghijklmnop?cluster=devnet');
  });
});

describe('Reputation and leaderboard', () => {
  beforeEach(async () => {
    // Which badges this device has shown its tester ("New") starts empty for each test.
    await AsyncStorage.clear();
    mockUser = { id: 'tester-1', role: 'tester' };
    mockRepError = null;
    mockBoardError = null;
    mockRepOptions.length = 0;
    mockDismissTo.mockReset();
    mockRep = {
      points: 25,
      noCashValue: true,
      events: [{ kind: 'accepted', points: 10, createdAt: '2026-10-05T00:00:00.000Z', studyTitle: 'Checkout' }],
      badges: [{ id: 'first_accepted', label: 'First accepted test', description: 'A builder accepted your first test.' }],
      progress: [
        { id: 'first_accepted', earned: true, current: 1, target: 1 },
        { id: 'reliable_tester', earned: false, current: 2, target: 5 },
        { id: 'helpful_feedback', earned: false, current: 1, target: 3 },
        { id: 'device_specialist', earned: false, current: 2, target: 3 },
      ],
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
    expect(within(screen.getByTestId('badge-first_accepted')).getByText('First accepted test')).toBeTruthy();
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
    const row = screen.getByTestId('leaderboard-row-1');
    expect(row).toHaveTextContent(/Careful Cat.*9 decided · 1 badge.*72.*quality/);
    // One sentence for assistive tech; an alias, never a name, email or wallet.
    expect(row.props.accessibilityLabel).toBe('Rank 1: Careful Cat. Quality 72 of 100, 9 decided tests, 1 badge, the top one First accepted test.');
    // The score is set in the title's face but is no heading (the web would make each one an h1).
    expect(within(row).queryAllByRole('header', { includeHiddenElements: true })).toHaveLength(0);
  });

  it('every badge shows: earned glass with what it was earned for, the rest with the rule and the count toward it', async () => {
    await render(tree(<ReputationScreen />));
    expect(screen.getByTestId('badge-first_accepted')).toHaveTextContent(/First accepted test.*A builder accepted your first test\..*Earned/);
    expect(screen.getByTestId('badge-helpful_feedback')).toHaveTextContent(/Helpful feedback.*Builders mark your feedback helpful 3 times\..*1 of 3 helpful marks/);
    expect(screen.getByTestId('badge-reliable_tester')).toHaveTextContent(/2 of 5 decided tests/);
    expect(screen.getByTestId('badge-device_specialist')).toHaveTextContent(/2 of 3 accepted tests on one platform/);
    // The hero: the hardest badge earned, announced once (the medallion itself is silent).
    expect(screen.getByTestId('reputation-hero')).toHaveTextContent(/TOP BADGE.*First accepted test/);
    expect(screen.getByTestId('reputation-hero-badge').props.accessibilityLabel).toMatch(/^Top badge: First accepted test, earned/);
    expect(screen.queryByLabelText(/^First accepted test, earned/)).toBeNull();
    expect(within(screen.getByTestId('reputation-hero-badge')).queryAllByRole('header', { includeHiddenElements: true })).toHaveLength(0);
    // Points carry the word, and no currency.
    expect(screen.getByTestId('reputation-events')).toHaveTextContent(/\+10 points/);
  });

  it('a badge reads New on the visit it first shows, and not after', async () => {
    await render(tree(<ReputationScreen />));
    await settle();
    expect(screen.getByTestId('badge-first_accepted-new')).toBeTruthy();
    expect(screen.getByLabelText('Top badge: First accepted test, earned, new')).toBeTruthy();
    await screen.unmount();
    await render(tree(<ReputationScreen />));
    await settle();
    expect(screen.queryByTestId('badge-first_accepted-new')).toBeNull();
  });

  it('Reliable tester with its count full says the quality bar is what is left', async () => {
    mockRep = { ...mockRep, badges: [], progress: mockRep.progress.map((p) => (p.id === 'reliable_tester' ? { ...p, current: 5 } : { ...p, earned: false, current: 0 })), stats: { ...mockRep.stats, decided: 7, qualityScore: 48 } };
    await render(tree(<ReputationScreen />));
    expect(screen.getByTestId('badge-reliable_tester')).toHaveTextContent(/Needs a quality score of 60; yours is 48/);
    expect(screen.getByTestId('reputation-no-badges')).toHaveTextContent('No badges yet. Your first accepted test earns one.');
    expect(screen.getByTestId('reputation-hero')).toHaveTextContent(/FIRST BADGE.*First accepted test.*0 of 1 accepted test/);
  });

  it('an API from before the counts (no progress) still shows every badge, earned or not yet, with no count', async () => {
    mockRep = { ...mockRep, progress: [] };
    await render(tree(<ReputationScreen />));
    expect(screen.getByTestId('badge-first_accepted')).toHaveTextContent(/Earned/);
    expect(screen.getByTestId('badge-helpful_feedback')).toHaveTextContent(/Builders mark your feedback helpful 3 times..*Not earned yet/);
    expect(screen.getByTestId('badge-helpful_feedback')).not.toHaveTextContent(/of 1/);
  });

  it('the top three share the first card; your own place is pinned below the board', async () => {
    mockBoard = {
      items: ['Ana', 'Ben', 'Cy', 'Dee'].map((alias, i) => ({ rank: i + 1, alias, qualityScore: 90 - i * 5, decided: 9 - i, badges: i === 0 ? ['reliable_tester', 'first_accepted'] : [] })),
      windowDays: 90,
      minDecided: 3,
    };
    mockRep = { ...mockRep, leaderboard: { optedIn: true, alias: 'Dee', rank: 4, minDecided: 3 } };
    await render(tree(<LeaderboardScreen />));
    expect(screen.getByTestId('leaderboard-row-1').props.accessibilityLabel).toMatch(/the top one Reliable tester/);
    for (const rank of [1, 2, 3]) expect(within(screen.getByTestId('leaderboard-top')).getByTestId(`leaderboard-row-${rank}`)).toBeTruthy();
    expect(within(screen.getByTestId('leaderboard-top')).queryByTestId('leaderboard-row-4')).toBeNull();
    expect(within(screen.getByTestId('leaderboard-rest')).getByTestId('leaderboard-row-4')).toBeTruthy();
    expect(screen.getByTestId('leaderboard-you')).toHaveTextContent(/You · Dee.*Rank 4 of 4 · Quality 34/);
  });

  it.each(['builder', 'admin'])('a %s sees the board with no row of their own, and never asks for a tester’s reputation', async (role) => {
    mockUser = { id: `${role}-1`, role };
    await render(tree(<LeaderboardScreen />));
    expect(screen.getByTestId('leaderboard-row-1')).toBeTruthy();
    expect(screen.queryByTestId('leaderboard-you')).toBeNull();
    expect(mockRepOptions).toContainEqual({ enabled: false });
    expect(mockRepOptions).not.toContainEqual({ enabled: true });
  });

  it('no pinned row while the board’s refresh has failed (its old data stays behind)', async () => {
    mockBoardError = new Error('offline');
    await render(tree(<LeaderboardScreen />));
    expect(screen.queryByTestId('leaderboard-you')).toBeNull();
  });

  it('no pinned row while your reputation failed to load (it would show stale numbers)', async () => {
    mockRepError = new Error('offline');
    await render(tree(<LeaderboardScreen />));
    expect(screen.getByTestId('leaderboard-row-1')).toBeTruthy();
    expect(screen.queryByTestId('leaderboard-you')).toBeNull();
  });

  it('hidden or not ranked yet, the pinned row says so, and Show me goes back to the settings', async () => {
    await render(tree(<LeaderboardScreen />));
    expect(screen.getByTestId('leaderboard-you')).toHaveTextContent(/You’re hidden\. Your points and badges still count\./);
    expect(screen.getByTestId('leaderboard-you-place').props.accessibilityLabel).toBe('You. You’re hidden. Your points and badges still count.');
    // Show me is a button of its own, outside the place's one accessibility element.
    expect(insideAccessibleView(screen.getByTestId('leaderboard-show-me'))).toBe(false);
    await act(async () => fireEvent.press(screen.getByTestId('leaderboard-show-me')));
    // Back to the settings, or Reputation in this screen's place when there is no history.
    expect(mockDismissTo).toHaveBeenCalledWith('/reputation');
    expect(screen.getByTestId('leaderboard-show-me').props.accessibilityHint).toBe('Opens Reputation, with your leaderboard settings');
    await screen.unmount();
    mockRep = { ...mockRep, leaderboard: { optedIn: true, alias: 'Tara', rank: null, minDecided: 3 } };
    await render(tree(<LeaderboardScreen />));
    expect(screen.getByTestId('leaderboard-you')).toHaveTextContent(/Not ranked yet: 2 of 3 decided tests in the last 90 days/);
    expect(screen.queryByTestId('leaderboard-show-me')).toBeNull();
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
