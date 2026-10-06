import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { canAddFinding, commitStatus, decisionView } from '../src/screens/review/decision';
import { DockSlot, LAND_PEAK, useLanding } from '../src/screens/review/ReviewParts';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import { PASS_LEAVE_AFTER, PASS_MIN_AFTER_PRESS } from '../src/ui/patterns';
import Review from '../app/builder/review/[id]';

// Builder review (A-Review): every testID, label and flow of the pre-Lens screen; the evidence
// strip (open on demand, the failure under the strip); the docked Decision bar; U7 on Approve (the
// sheet holds through the Commit pass, the dock and the Decision notice trade places when it
// leaves, and the tail lands on the notice); Reject with its required reason; the dispute card.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'p1' }), Redirect: () => null, router: { push: jest.fn() } }));
// The builder's linked devnet wallet (used by the devnet pilot's payout approval).
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: { id: 'b1', role: 'builder', wallet: { address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' } }, features: { testCredits: true, devnetTransfers: true } }) }));
const mockSign = jest.fn();
jest.mock('../src/wallet/signServerTransaction', () => ({ signServerTransaction: (...a: unknown[]) => mockSign(...a) }));
jest.mock('expo-video', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { useVideoPlayer: () => ({}), VideoView: (props: { testID?: string }) => <View testID={props.testID} /> };
});
// The devnet transfer card is the wallet module's own (U8); only whether the screen shows it matters here.
jest.mock('../src/wallet/TransferCard', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { TransferCard: () => <Text testID="transfer-card">transfer</Text> };
});

const mockApi = jest.fn();
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, api: (...a: unknown[]) => mockApi(...a), mediaUrl: (t: string) => `http://media/${t}` };
});

type Item = Record<string, unknown>;
let mockPart: Item;
let mockEvidence: Item[];
let mockFindings: Item[];
let mockDisputes: Item[];
let mockAi = false;
/** A failed background refetch: the participation keeps its cached data and carries the error. */
let mockPartError: Error | null = null;
jest.mock('../src/lib/queries', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const ok = (data: unknown) => ({ isLoading: false, error: null, data, refetch: jest.fn() });
  return {
    // A real query, seeded, so the decision's setQueryData shows on screen as it does in the app.
    useParticipation: (id: string) => {
      const q = useQuery({ queryKey: ['participation', id], queryFn: async () => mockPart, initialData: mockPart, staleTime: Infinity });
      return mockPartError ? { ...q, error: mockPartError, isError: true } : q;
    },
    useStudy: () => ok({ id: 's1', tasks: [{ id: 't1', instruction: 'Add any item to the cart and open checkout' }, { id: 't2', instruction: 'Reach the receipt screen' }] }),
    useEvidence: () => ok({ items: mockEvidence }),
    useFindings: () => ok({ items: mockFindings }),
    useAiStatus: () => ok({ available: mockAi }),
    useStudyDisputes: () => ok({ items: mockDisputes }),
  };
});

function participation(over: Item = {}): Item {
  return {
    id: 'p1',
    studyId: 's1',
    testerDisplayName: 'Demo Tester',
    status: 'submitted',
    rewardCredits: 50,
    reward: { kind: 'test_credits', credits: 50 },
    payoutAddress: null,
    payout: null,
    consentVersion: 1,
    consentedAt: '2026-10-03T13:58:00.000Z',
    submittedAt: '2026-10-03T14:05:00.000Z',
    decidedAt: null,
    decisionReason: null,
    taskNotes: [{ taskId: 't1', note: 'The checkout button was below the fold.' }],
    ...over,
  };
}
const EVIDENCE = [
  { id: 'e1', kind: 'screen_recording', capturedOn: 'android', sizeBytes: 3355443, mimeType: 'video/mp4' },
  { id: 'e2', kind: 'screenshot', capturedOn: 'web', sizeBytes: 49152, mimeType: 'image/png' },
];

let reduced = false;
beforeEach(() => {
  jest.useFakeTimers();
  reduced = false;
  mockApi.mockReset();
  mockPart = participation();
  mockEvidence = EVIDENCE;
  mockFindings = [];
  mockDisputes = [];
  mockAi = false;
  mockPartError = null;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduced));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
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

/** One provider tree for render and rerender, so a rerender keeps component state and the scheme. */
let client: QueryClient;
function wrap(ui: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">
          <Scheme>{ui}</Scheme>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

async function renderIn(ui: ReactNode, scheme: ThemePreference = 'dark') {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const result = await render(wrap(ui));
  await act(async () => setPreference?.(scheme));
  // Let the arrival and the entrance steps settle: RNTL treats opacity 0 as hidden.
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  return result;
}

const settle = () =>
  act(async () => {
    await Promise.resolve();
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
/** Lays the evidence strip out at the board's column width, so its 2-up tiles render. */
async function layoutStrip() {
  await fireEvent(screen.getByTestId('evidence-strip'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 0 } } });
}

describe('review view rules', () => {
  it('findings open once the tester has submitted', () => {
    expect(canAddFinding('submitted')).toBe(true);
    expect(canAddFinding('approved')).toBe(true);
    expect(canAddFinding('in_progress')).toBe(false);
    expect(canAddFinding('consented')).toBe(false);
    expect(canAddFinding('withdrawn')).toBe(false);
  });

  it('the Approve sheet light follows the request: pending, error, then the pass', () => {
    expect(commitStatus({ passing: false, isPending: true, isError: false })).toBe('pending');
    expect(commitStatus({ passing: false, isPending: false, isError: true })).toBe('error');
    expect(commitStatus({ passing: true, isPending: false, isError: false })).toBe('success');
    expect(commitStatus({ passing: false, isPending: false, isError: false })).toBe('idle');
  });

  it('the dock and the Decision notice trade places only when the approval sheet leaves', () => {
    expect(decisionView({ status: 'submitted', decidedAt: null }, false)).toEqual({ dock: true, notice: false });
    // The server has answered but the Commit pass still plays in the sheet.
    expect(decisionView({ status: 'approved', decidedAt: '2026-10-03T14:30:00Z' }, true)).toEqual({ dock: true, notice: false });
    expect(decisionView({ status: 'approved', decidedAt: '2026-10-03T14:30:00Z' }, false)).toEqual({ dock: false, notice: true });
    expect(decisionView({ status: 'in_progress', decidedAt: null }, false)).toEqual({ dock: false, notice: false });
  });
});

describe('review screen', () => {
  it('submitted: the head, the AI panel, task notes, evidence, the form and the docked Decision bar', async () => {
    await renderIn(<Review />);
    expect(screen.getByTestId('review-screen')).toBeTruthy();
    expect(screen.getByTestId('review-status')).toHaveTextContent('AWAITING REVIEW');
    expect(screen.getByText('Demo Tester')).toBeTruthy();
    expect(screen.getByLabelText('50 test credits on approval')).toBeTruthy();
    expect(screen.getByTestId('ai-unavailable')).toHaveTextContent(/Analysis unavailable/);
    expect(screen.getByTestId('review-note-0')).toHaveTextContent('The checkout button was below the fold.');
    expect(screen.getByTestId('review-note-1')).toHaveTextContent('No notes.');
    expect(screen.getByText('Playback links expire after 5 minutes.')).toBeTruthy();
    expect(screen.getByTestId('finding-form')).toBeTruthy();
    expect(screen.getByTestId('finding-evidence')).toBeTruthy();
    expect(screen.getByText('Decision').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('review-approve')).toBeTruthy();
    expect(screen.getByTestId('review-reject')).toBeTruthy();
    expect(screen.queryByTestId('review-decided')).toBeNull();
    // Nothing is uploaded or written yet, so no Findings list.
    expect(screen.queryByTestId('finding-item')).toBeNull();
  });

  it('no Decision dock while the error panel replaces the screen (cached data, failed refetch)', async () => {
    mockPartError = new Error('Network request failed');
    await renderIn(<Review />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    expect(screen.queryByTestId('review-approve')).toBeNull();
    expect(screen.queryByTestId('review-reject')).toBeNull();
  });

  it('the AI panel names an available provider but never invents an analysis', async () => {
    mockAi = true;
    await renderIn(<Review />);
    expect(screen.getByTestId('ai-unavailable')).toHaveTextContent(/AI analysis/);
  });

  it('evidence: View asks for a playback link and opens the media in its tile', async () => {
    mockApi.mockImplementation(async (route: string) => (route === 'playbackToken' ? { token: 'tok' } : null));
    await renderIn(<Review />);
    await layoutStrip();
    expect(screen.getAllByTestId('evidence-item')).toHaveLength(2);
    expect(screen.getByText('Screen recording')).toBeTruthy();
    expect(screen.getByText('android · 3.2 MB')).toBeTruthy();
    // Each View reads before its caption, so its name says which item it opens.
    expect(screen.getAllByTestId('evidence-view').map((v) => v.props.accessibilityLabel)).toEqual(['View screen recording 1', 'View screenshot 2']);
    await fireEvent.press(screen.getAllByTestId('evidence-view')[1]!);
    await settle();
    expect(mockApi).toHaveBeenCalledWith('playbackToken', { params: { id: 'e2' } });
    expect(screen.getByTestId('evidence-media')).toBeTruthy();
    expect(screen.getAllByTestId('evidence-view')).toHaveLength(1);
  });

  it('evidence: a failed link shows "Can’t open evidence" under the strip', async () => {
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockImplementation(async () => {
      throw new ApiError('NOT_FOUND', 'This item doesn’t exist or you don’t have access to it.');
    });
    await renderIn(<Review />);
    await layoutStrip();
    await fireEvent.press(screen.getAllByTestId('evidence-view')[0]!);
    await settle();
    await advance(400);
    expect(screen.getByText('Can’t open evidence')).toBeTruthy();
    expect(screen.getByText('This item doesn’t exist or you don’t have access to it.')).toBeTruthy();
  });

  it('no evidence: the empty state in place of the strip', async () => {
    mockEvidence = [];
    await renderIn(<Review />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/No evidence uploaded/);
    expect(screen.queryByTestId('finding-evidence')).toBeNull();
  });

  it('findings list with its byline; in progress, the form waits for the submission', async () => {
    mockFindings = [{ id: 'f1', title: 'OTP destination unclear', severity: 'major', description: 'Tester could not tell where the code was sent.', createdAt: '2026-10-03T14:21:00Z' }];
    mockPart = participation({ status: 'in_progress', submittedAt: null });
    await renderIn(<Review />);
    expect(screen.getByTestId('finding-item')).toHaveTextContent(/OTP destination unclear/);
    expect(screen.getByTestId('finding-item')).toHaveTextContent(/Written by a person/);
    expect(screen.getByText('Findings can be added after the tester submits.')).toBeTruthy();
    expect(screen.queryByTestId('finding-form')).toBeNull();
    expect(screen.queryByTestId('review-approve')).toBeNull();
  });

  it('U7: Approve holds its sheet through the Commit pass, then the Decision notice takes the dock’s place', async () => {
    const approved = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z', decisionReason: null });
    mockApi.mockImplementation(async (route: string) => (route === 'approve' ? approved : null));
    await renderIn(<Review />);
    await fireEvent.press(screen.getByTestId('review-approve'));
    expect(screen.getByText('Approve and credit 50 test credits?')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('approve-note'), 'Clear notes, thanks.');
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('approve', { params: { id: 'p1' }, body: { note: 'Clear notes, thanks.' } });
    // Mid-pass: the sheet is up and locked, the dock still holds its place, no notice yet.
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(screen.getByTestId('review-approve')).toBeTruthy();
    expect(screen.queryByTestId('review-decided')).toBeNull();
    await advance(PASS_MIN_AFTER_PRESS + PASS_LEAVE_AFTER);
    // The sheet has left: the Decision notice has taken the dock's place, and the dock plays its 240ms exit.
    expect(screen.getByTestId('review-decided')).toHaveTextContent(/Decision: Approved/);
    expect(screen.getByTestId('review-decided')).toHaveTextContent(/Decided/);
    expect(screen.getByTestId('transfer-card')).toBeTruthy();
    await advance(300);
    await advance(300);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(screen.queryByTestId('review-approve')).toBeNull();
  });

  it('reduced motion: Approve closes its sheet as soon as the request succeeds', async () => {
    reduced = true;
    mockApi.mockImplementation(async () => participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z' }));
    await renderIn(<Review />);
    await fireEvent.press(screen.getByTestId('review-approve'));
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await settle();
    await advance(300);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(screen.getByTestId('review-decided')).toHaveTextContent(/Approved/);
  });

  it('Reject needs a reason of 10 characters, sends it, and shows the decision', async () => {
    mockApi.mockImplementation(async () => participation({ status: 'rejected', decidedAt: '2026-10-03T14:30:00.000Z', decisionReason: 'No evidence attached for the wallet step.' }));
    await renderIn(<Review />);
    await fireEvent.press(screen.getByTestId('review-reject'));
    expect(screen.getByText('Reject this submission?')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reject-reason'), 'short');
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('reject-reason'), 'No evidence attached for the wallet step.');
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('reject', { params: { id: 'p1' }, body: { reason: 'No evidence attached for the wallet step.' } });
    await advance(300);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(screen.getByTestId('review-decided')).toHaveTextContent(/Decision: Rejected/);
    expect(screen.getByTestId('review-decided')).toHaveTextContent(/No evidence attached for the wallet step\./);
  });

  it('binds a decision to what was confirmed: held offline, it still sends its own note, and Reject reopens it while it is held', async () => {
    mockApi.mockImplementation(async () => participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z' }));
    await renderIn(<Review />);
    // A browser that reports offline holds the request; it is sent on reconnect.
    onlineManager.setOnline(false);
    try {
      await fireEvent.press(screen.getByTestId('review-approve'));
      await fireEvent.changeText(screen.getByTestId('approve-note'), 'Clear notes, thank you.');
      await fireEvent.press(screen.getByTestId('confirm-ok'));
      await settle();
      expect(mockApi).not.toHaveBeenCalledWith('approve', expect.anything());
      // After the pending escape Cancel closes; Reject then reopens the held Approve, as it was sent.
      await advance(15_100);
      await fireEvent.press(screen.getByTestId('confirm-cancel'));
      await advance(400);
      await fireEvent.press(screen.getByTestId('review-reject'));
      expect(screen.getByText(/Approve and credit/)).toBeTruthy();
      expect(screen.queryByText('Reject this submission?')).toBeNull();
      expect(screen.getByTestId('approve-note').props.value).toBe('Clear notes, thank you.');
      // Text typed now was never confirmed, so it is not what goes out.
      await fireEvent.changeText(screen.getByTestId('approve-note'), 'Typed after the confirm.');
      // Locked while sending (Lens follow-ups P3-5).
      expect(screen.getByTestId('approve-note').props.editable).toBe(false);
      expect(screen.getByTestId('approve-note').props.value).toBe('Clear notes, thank you.');
    } finally {
      await act(async () => onlineManager.setOnline(true));
    }
    await settle();
    await advance(10);
    expect(mockApi).toHaveBeenCalledWith('approve', { params: { id: 'p1' }, body: { note: 'Clear notes, thank you.' } });
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('a failed decision keeps the sheet open with the server message', async () => {
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockImplementation(async () => {
      throw new ApiError('CONFLICT', 'The study budget cannot cover this reward.');
    });
    await renderIn(<Review />);
    await fireEvent.press(screen.getByTestId('review-approve'));
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await settle();
    await advance(100);
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
    // The notice enters by itself (its entrance style is not replayed by the Jest renderer).
    const error = screen.getByTestId('decision-error', { includeHiddenElements: true });
    expect(error).toHaveTextContent(/Decision not saved/);
    expect(error).toHaveTextContent(/budget cannot cover/);
  });

  // Devnet pilot: an approved payout waits for the builder's vote (2 of 3) in their wallet.
  const devnetPayout = (status: string, settlement = 'squads_devnet') => ({
    id: 'set-1', participationId: 'p1', studyId: 's1', studyTitle: 'S', amountUnits: 1_000_000, asset: 'USDC', decimals: 6,
    destination: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', settlement, status, signature: null, failureReason: null, attempts: 0,
    authorizedAt: '2026-10-03T14:30:00.000Z', settledAt: null,
  });
  /** A server-built Squads approval for the linked wallet (fee payer = linked, Squads v4, unsigned). */
  function approvalPlan() {
    const { base58 } = jest.requireActual<typeof import('@scure/base')>('@scure/base');
    const linked = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
    const vault = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
    const keys = [linked, vault, 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'];
    const bytes = [1, ...new Array(64).fill(0), 0x80, 1, 0, 1, keys.length];
    for (const k of keys) bytes.push(...base58.decode(k));
    bytes.push(...base58.decode(vault), 1, 2, 1, 1, 1, 7, 0);
    return {
      settlementId: 'set-1', kind: 'payout', transactionB64: Buffer.from(Uint8Array.from(bytes)).toString('base64'), multisig: vault, txIndex: 4,
      opId: `pqa-op1:${'cd'.repeat(32)}`, amountUnits: 1_000_000, destination: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', network: 'devnet', copy: 'Devnet test USDC, no value · test keys · not independent custody',
    };
  }

  it('devnet pilot: a payout awaiting approval → review the vote → sign in the wallet → submitted with its index and op id', async () => {
    mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z', reward: { kind: 'token', asset: 'USDC', decimals: 6, units: 1_000_000, settlement: 'squads_devnet' }, payout: devnetPayout('awaiting_approval') });
    const plan = approvalPlan();
    mockApi.mockImplementation(async (name: string) => (name === 'settlementApproval' ? plan : { settlementId: 'set-1', kind: 'payout', status: 'submitted', signature: '5igVote', network: 'devnet' }));
    mockSign.mockImplementation(async (_p: unknown, _c: unknown, send: (s: string) => Promise<unknown>) => {
      await send('5igVote');
      return { signature: '5igVote' };
    });
    await renderIn(<Review />);
    expect(screen.queryByTestId('reward-approval-sign')).toBeNull();
    await fireEvent.press(screen.getByTestId('reward-approval-review'));
    await settle();
    await settle();
    expect(mockApi).toHaveBeenCalledWith('settlementApproval', { params: { id: 'set-1' } });
    expect(screen.getByTestId('reward-approval-plan')).toHaveTextContent(/pqa-op1:cdcd/);
    await fireEvent.press(screen.getByTestId('reward-approval-sign'));
    await settle();
    await settle();
    expect(mockApi).toHaveBeenCalledWith('submitSettlementApproval', { params: { id: 'set-1' }, body: { signature: '5igVote', txIndex: 4, opId: plan.opId } });
  });

  it('the wallet vote is offered only for a devnet payout awaiting approval', async () => {
    mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z', payout: devnetPayout('submitted') });
    await renderIn(<Review />);
    expect(screen.queryByTestId('reward-approval-review')).toBeNull();
  });

  it('a disputed rejection shows the tester’s dispute; an overturned one shows the transfer card', async () => {
    mockPart = participation({ status: 'disputed', decidedAt: '2026-10-03T14:30:00.000Z', decisionReason: 'The receipt screen was never reached.' });
    mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'open', reason: 'My note explains the checkout button problem.', outcome: null, resolutionNote: null }];
    const { unmount } = await renderIn(<Review />);
    expect(screen.getByTestId('review-dispute')).toHaveTextContent(/Tester dispute/);
    expect(screen.getByTestId('review-dispute')).toHaveTextContent(/An admin will resolve it\./);
    expect(screen.queryByTestId('transfer-card')).toBeNull();
    expect(screen.queryByTestId('review-approve')).toBeNull();
    await unmount();
    mockPart = participation({ status: 'resolved', decidedAt: '2026-10-03T14:30:00.000Z', decisionReason: 'The receipt screen was never reached.' });
    mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'resolved', reason: 'My note explains the checkout button problem.', outcome: 'overturned', resolutionNote: 'The note documents the wallet step.' }];
    await renderIn(<Review />);
    expect(screen.getByTestId('review-dispute')).toHaveTextContent(/Overturned by an admin: The note documents the wallet step\./);
    expect(screen.getByTestId('transfer-card')).toBeTruthy();
  });

  it('renders flat in the light theme', async () => {
    await renderIn(<Review />, 'light');
    expect(screen.getByTestId('review-approve')).toBeTruthy();
    expect(screen.getByTestId('ai-unavailable')).toBeTruthy();
  });
});

describe('the landing tail and the dock slot', () => {
  it('the tail lands only on an in-session approval, peaking at 0.6 and going out', async () => {
    let value = () => 0;
    function Read({ land }: { land: number }) {
      const u = useLanding(land);
      value = () => u.value;
      return null;
    }
    const { rerender } = await renderIn(<Read land={0} />);
    await advance(400);
    expect(value()).toBe(0);
    await rerender(wrap(<Read land={1} />));
    await advance(240);
    expect(value()).toBeCloseTo(LAND_PEAK, 1);
    await advance(800);
    expect(value()).toBe(0);
  });

  it('the dock slot stays through its exit, then unmounts', async () => {
    const { rerender } = await renderIn(
      <DockSlot shown>
        <RNText testID="dock">dock</RNText>
      </DockSlot>,
    );
    expect(screen.getByTestId('dock')).toBeTruthy();
    await rerender(
      wrap(
        <DockSlot shown={false}>
          <RNText testID="dock">dock</RNText>
        </DockSlot>,
      ),
    );
    expect(screen.getByTestId('dock')).toBeTruthy();
    await advance(300);
    expect(screen.queryByTestId('dock')).toBeNull();
  });
});
