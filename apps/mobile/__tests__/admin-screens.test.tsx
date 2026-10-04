import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '../src/api/client';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import Disputes from '../app/(admin)/disputes';
import Moderation from '../app/(admin)/moderation';
import Stuck from '../app/(admin)/stuck';

// The admin Disputes (claim cards), Moderation (visibility ledger) and Stuck (triage queue) screens:
// their data, testIDs and copy are unchanged; these tests pin the Lens layouts, the S6 / S7
// behaviour, and the sheets: each opens clean for its target and keeps its frame while it leaves.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: jest.fn() }));
// Stuck's evidence item (playback via expo-video) belongs to the Review screen; only its presence matters here.
jest.mock('../src/evidence/EvidenceItem', () => ({ EvidenceItem: () => null }));
// The balance tile reports its pose (S6 weigh), so a test can read which way the sheet's tile leans.
jest.mock('../src/icons', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ...jest.requireActual('../src/icons'), BalanceTile: ({ pose }: { pose: string }) => <View testID={`balance-${pose}`} /> };
});

type Q = { isLoading: boolean; error: unknown; data: unknown; refetch: () => void };
const mockData: { disputes: Q; studies: Q; participation: Q; evidence: Q; stuck: Q } = {
  disputes: { isLoading: false, error: null, data: undefined, refetch: () => {} },
  studies: { isLoading: false, error: null, data: undefined, refetch: () => {} },
  participation: { isLoading: false, error: null, data: undefined, refetch: () => {} },
  evidence: { isLoading: false, error: null, data: undefined, refetch: () => {} },
  stuck: { isLoading: false, error: null, data: undefined, refetch: () => {} },
};
jest.mock('../src/lib/queries', () => ({
  useFocusRefetch: () => {},
  useAdminDisputes: () => mockData.disputes,
  useAdminStudies: () => mockData.studies,
  useParticipation: () => mockData.participation,
  useEvidence: () => mockData.evidence,
  useAdminStuck: () => mockData.stuck,
}));

const mockApi = api as jest.Mock;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

// Dark is the Lens look: every render asks for it, as the ui tests do.
let setScheme: ((p: ThemePreference) => void) | undefined;
function Dark({ children }: { children: ReactNode }) {
  setScheme = useTheme().setPreference;
  return <>{children}</>;
}

function tree(ui: ReactNode, client: QueryClient) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <ThemeProvider fonts="system">
          <Dark>{ui}</Dark>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

async function flush(ms = 0) {
  await act(async () => {
    setScheme?.('dark');
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

const iso = '2026-10-03T11:42:00.000Z';
const dispute = (over: Record<string, unknown>) => ({
  id: 'd1',
  participationId: 'p1',
  openedBy: 'u1',
  reason: 'My note explains the wallet step in detail; please re-check.',
  status: 'open',
  outcome: null,
  resolutionNote: null,
  resolvedBy: null,
  createdAt: iso,
  resolvedAt: null,
  ...over,
});
/** A sheet's text, read even while the sheet is leaving (it is hidden from accessibility then). */
const sheetText = (text: string) => screen.queryByText(text, { includeHiddenElements: true });
async function failWith(message: string) {
  const { ApiError } = jest.requireActual<typeof import('../src/api/client')>('../src/api/client');
  mockApi.mockRejectedValueOnce(new ApiError('CONFLICT_STATE', message, 409));
  await fireEvent.press(screen.getByTestId('confirm-ok'));
  await flush(10);
}

const study = (over: Record<string, unknown>) => ({ id: 's1', title: 'Wallet onboarding', objective: 'See whether new users understand the wallet step.', moderation: 'ok', status: 'published', slots: 5, slotsFilled: 1, ...over });

let client: QueryClient;
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mockApi.mockReset();
  mockData.participation.data = { decisionReason: 'No evidence attached for the wallet step.', testerDisplayName: 'Ravi', taskNotes: [{}, {}] };
  mockData.evidence.data = { items: [] };
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Disputes (claim cards)', () => {
  it('leads each card with the claim, the rejection reason in its well, the byline and an open card’s Resolve', async () => {
    mockData.disputes.data = { items: [dispute({}), dispute({ id: 'd2', status: 'resolved', outcome: 'overturned', resolutionNote: 'The note documents the wallet step.' })] };
    await render(tree(<Disputes />, client));
    await flush();
    const open = screen.getByTestId('dispute-open');
    expect(open).toHaveTextContent(/wallet step in detail/);
    expect(open).toHaveTextContent(/Rejection reason: No evidence attached for the wallet step\./);
    expect(within(open).getByText('Ravi')).toBeTruthy();
    expect(open).toHaveTextContent(/0 evidence item\(s\) · 2 note\(s\)/);
    expect(within(open).getByTestId('dispute-resolve')).toBeTruthy();
    const resolved = screen.getByTestId('dispute-resolved');
    expect(resolved).toHaveTextContent(/Overturned: reward credited\. The note documents the wallet step\./);
    // A resolved dispute is decided: no Resolve on its card.
    expect(within(resolved).queryByTestId('dispute-resolve')).toBeNull();
  });

  it('reserves the byline while the participation loads, then fills in the rejection well without moving Resolve', async () => {
    mockData.disputes.data = { items: [dispute({})] };
    mockData.participation.data = undefined;
    const r = await render(tree(<Disputes />, client));
    await flush();
    const open = screen.getByTestId('dispute-open');
    expect(open).not.toHaveTextContent(/Rejection reason:/);
    expect(within(open).getByTestId('dispute-resolve')).toBeTruthy();

    mockData.participation.data = { decisionReason: 'No evidence attached for the wallet step.', testerDisplayName: 'Ravi', taskNotes: [{}] };
    await r.rerender(tree(<Disputes />, client));
    await flush(400);
    const loaded = screen.getByTestId('dispute-open');
    expect(loaded).toHaveTextContent(/Rejection reason: No evidence attached for the wallet step\./);
    expect(within(loaded).getByText('Ravi')).toBeTruthy();
    expect(within(loaded).getByTestId('dispute-resolve')).toBeTruthy();
  });

  it('resolves through the never-lit sheet with the 5-character hint, then shows the verdict on the card', async () => {
    mockData.disputes.data = { items: [dispute({})] };
    const r = await render(tree(<Disputes />, client));
    await flush();
    await fireEvent.press(screen.getByTestId('dispute-resolve'));
    await flush(500);
    expect(screen.getByText('Resolve dispute')).toBeTruthy();
    expect(screen.getByText('At least 5 characters.')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('dispute-outcome-overturned'));
    await fireEvent.changeText(screen.getByTestId('dispute-note'), 'The note documents the wallet step.');
    expect(screen.getByTestId('confirm-ok')).toBeEnabled();
    mockApi.mockResolvedValueOnce(dispute({ status: 'resolved', outcome: 'overturned', resolutionNote: 'The note documents the wallet step.' }));
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await flush(10);
    expect(mockApi).toHaveBeenCalledWith('resolveDispute', { params: { id: 'd1' }, body: { outcome: 'overturned', note: 'The note documents the wallet step.' } });
    // The refetched list: the same card (same key) turns resolved and its verdict row enters.
    mockData.disputes.data = { items: [dispute({ status: 'resolved', outcome: 'overturned', resolutionNote: 'The note documents the wallet step.' })] };
    await r.rerender(tree(<Disputes />, client));
    await flush(1000);
    expect(screen.queryByTestId('dispute-open')).toBeNull();
    expect(screen.getByTestId('dispute-resolved')).toHaveTextContent(/Overturned: reward credited\./);
  });

  it('keeps the failure branch’s own title', async () => {
    mockData.disputes.data = { items: [dispute({})] };
    await render(tree(<Disputes />, client));
    await flush();
    await fireEvent.press(screen.getByTestId('dispute-resolve'));
    await flush(500);
    await fireEvent.changeText(screen.getByTestId('dispute-note'), 'Upholding: no evidence.');
    const { ApiError } = jest.requireActual<typeof import('../src/api/client')>('../src/api/client');
    mockApi.mockRejectedValueOnce(new ApiError('CONFLICT_STATE', 'Dispute already resolved', 409));
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await flush(10);
    expect(screen.getByText('Not resolved')).toBeTruthy();
    expect(screen.getByText('Dispute already resolved')).toBeTruthy();
  });

  it('opens each Resolve sheet clean: a cancelled verdict, note and failure never carry over', async () => {
    mockData.disputes.data = { items: [dispute({}), dispute({ id: 'd2', reason: 'The second claim.' })] };
    await render(tree(<Disputes />, client));
    await flush();
    await fireEvent.press(screen.getAllByTestId('dispute-resolve')[0]!);
    await flush(500);
    await fireEvent.press(screen.getByTestId('dispute-outcome-overturned'));
    await fireEvent.changeText(screen.getByTestId('dispute-note'), 'Overturning: the note covers it.');
    await failWith('Dispute already resolved');
    expect(screen.getByText('Not resolved')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await flush(500);
    // The next dispute's sheet: Uphold, an empty note, no stale failure, the 5-character gate closed.
    await fireEvent.press(screen.getAllByTestId('dispute-resolve')[1]!);
    await flush(500);
    expect(screen.getByTestId('dispute-note').props.value).toBe('');
    expect(screen.getByTestId('dispute-outcome-upheld')).toBeSelected();
    expect(screen.queryByText('Not resolved')).toBeNull();
    expect(screen.queryByText('Dispute already resolved')).toBeNull();
    expect(screen.getByTestId('confirm-ok')).toBeDisabled();
    expect(screen.getByTestId('balance-uphold')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('dispute-note'), 'Upholding the rejection.');
    mockApi.mockResolvedValueOnce(dispute({ id: 'd2', status: 'resolved', outcome: 'upheld' }));
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await flush(10);
    expect(mockApi).toHaveBeenLastCalledWith('resolveDispute', { params: { id: 'd2' }, body: { outcome: 'upheld', note: 'Upholding the rejection.' } });
  });

  it('keeps the sheet’s balance pose while it animates out after Cancel', async () => {
    mockData.disputes.data = { items: [dispute({})] };
    await render(tree(<Disputes />, client));
    await flush();
    await fireEvent.press(screen.getByTestId('dispute-resolve'));
    await flush(500);
    await fireEvent.press(screen.getByTestId('dispute-outcome-overturned'));
    expect(screen.getByTestId('balance-overturn')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await flush(10);
    // Still leaving (240ms): the outcome already reset, the tile has not flipped.
    expect(sheetText('Resolve dispute')).toBeTruthy();
    expect(screen.getByTestId('balance-overturn', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('balance-uphold', { includeHiddenElements: true })).toBeNull();
  });

  it('shows the empty state when there are no disputes', async () => {
    mockData.disputes.data = { items: [] };
    await render(tree(<Disputes />, client));
    await flush();
    expect(screen.getByText('No disputes')).toBeTruthy();
  });
});

describe('Moderation (visibility ledger)', () => {
  it('files each study under its section with a count, its lifecycle, the slot readout and its compact action', async () => {
    mockData.studies.data = { items: [study({}), study({ id: 's2', title: 'Checkout flow', moderation: 'suspended', status: 'closed', slotsFilled: 0 })] };
    await render(tree(<Moderation />, client));
    await flush();
    expect(screen.getByText('VISIBLE · 1')).toBeTruthy();
    expect(screen.getByText('SUSPENDED · 1')).toBeTruthy();
    const visible = screen.getByTestId('moderation-visible');
    const suspended = screen.getByTestId('moderation-suspended');
    expect(within(visible).getByText('Wallet onboarding')).toBeTruthy();
    // One mono readout; the lifecycle leads it, so a closed study reads apart from a live one.
    expect(within(visible).getByText('published · 1/5 slots')).toBeTruthy();
    expect(within(suspended).getByText('closed · 0/5 slots')).toBeTruthy();
    expect(within(visible).getByTestId('moderate-study')).toHaveTextContent('Suspend');
    expect(within(suspended).getByText('Checkout flow')).toBeTruthy();
    expect(within(suspended).getByTestId('moderate-study')).toHaveTextContent('Reinstate');
    // The section is the moderation status: rows carry no pill.
    expect(screen.queryByText('PUBLISHED')).toBeNull();
  });

  it('keeps an empty section closed with its quiet row', async () => {
    mockData.studies.data = { items: [study({})] };
    await render(tree(<Moderation />, client));
    await flush();
    expect(within(screen.getByTestId('moderation-suspended')).getByText('No suspended studies')).toBeTruthy();
    expect(screen.queryByText('No visible studies')).toBeNull();
  });

  it('S7: a suspended study sinks in its section after the sheet leaves, then moves to Suspended', async () => {
    mockData.studies.data = { items: [study({})] };
    const r = await render(tree(<Moderation />, client));
    await flush();
    await fireEvent.press(screen.getByTestId('moderate-study'));
    await flush(500);
    expect(screen.getByText('Suspend study?')).toBeTruthy();
    expect(screen.getByText('At least 5 characters.')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('moderation-reason'), 'Checking moderation audit trail');
    mockApi.mockResolvedValueOnce(study({ moderation: 'suspended' }));
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await flush(10);
    expect(mockApi).toHaveBeenCalledWith('moderateStudy', { params: { id: 's1' }, body: { action: 'suspend', reason: 'Checking moderation audit trail' } });
    // The list refetches at once, but the row is held in Visible while it sinks.
    mockData.studies.data = { items: [study({ moderation: 'suspended' })] };
    await r.rerender(tree(<Moderation />, client));
    await flush(100);
    expect(within(screen.getByTestId('moderation-visible')).getByText('Wallet onboarding')).toBeTruthy();
    expect(within(screen.getByTestId('moderation-suspended')).queryByText('Wallet onboarding')).toBeNull();
    // A held row keeps its section's label, and its action waits for the move.
    expect(within(screen.getByTestId('moderation-visible')).getByTestId('moderate-study')).toHaveTextContent('Suspend');
    await fireEvent.press(within(screen.getByTestId('moderation-visible')).getByTestId('moderate-study'));
    expect(screen.queryByText('Reinstate study?')).toBeNull();
    // After the sink it moves; the row it left fades out and Visible keeps its quiet row.
    await flush(400);
    await flush(400);
    expect(within(screen.getByTestId('moderation-suspended')).getByText('Wallet onboarding')).toBeTruthy();
    expect(within(screen.getByTestId('moderation-visible')).queryByText('Wallet onboarding')).toBeNull();
    expect(within(screen.getByTestId('moderation-visible')).getByText('No visible studies')).toBeTruthy();
  });

  it('wraps the readout after the dot instead of clipping the slot count', async () => {
    mockData.studies.data = { items: [study({})] };
    await render(tree(<Moderation />, client));
    await flush();
    const readout = within(screen.getByTestId('moderation-visible')).getByText('published · 1/5 slots');
    // Two lines allowed, never ellipsized to one; no-break spaces keep "1/5 slots" whole.
    expect(readout.props.numberOfLines).toBe(2);
    expect(readout.props.children).toBe('published\u00A0· 1/5\u00A0slots');
  });

  it('opens each sheet clean: a cancelled reason and an earlier failure never carry over', async () => {
    mockData.studies.data = { items: [study({}), study({ id: 's2', title: 'Checkout flow' })] };
    await render(tree(<Moderation />, client));
    await flush();
    await fireEvent.press(screen.getAllByTestId('moderate-study')[0]!);
    await flush(500);
    await fireEvent.changeText(screen.getByTestId('moderation-reason'), 'Misleading payout claims');
    await failWith('Study already suspended');
    expect(screen.getByText('Action failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await flush(500);
    await fireEvent.press(screen.getAllByTestId('moderate-study')[1]!);
    await flush(500);
    expect(screen.getByTestId('moderation-reason').props.value).toBe('');
    expect(screen.queryByText('Action failed')).toBeNull();
    expect(screen.queryByText('Study already suspended')).toBeNull();
    expect(screen.getByTestId('confirm-ok')).toBeDisabled();
  });

  it('keeps the sheet’s title and confirm while it animates out after Cancel', async () => {
    mockData.studies.data = { items: [study({})] };
    await render(tree(<Moderation />, client));
    await flush();
    await fireEvent.press(screen.getByTestId('moderate-study'));
    await flush(500);
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await flush(10);
    expect(sheetText('Suspend study?')).toBeTruthy();
    expect(sheetText('Reinstate study?')).toBeNull();
  });

  it('shows the empty state when there is nothing to moderate', async () => {
    mockData.studies.data = { items: [] };
    await render(tree(<Moderation />, client));
    await flush();
    expect(screen.getByText('Nothing to moderate')).toBeTruthy();
  });
});

const stuckItem = (id: string, title: string): Record<string, unknown> => ({
  participation: {
    id,
    studyId: `s-${id}`,
    testerId: 't1',
    testerDisplayName: 'Tara Tester',
    status: 'submitted',
    submittedAt: iso,
    rewardCredits: 50,
    taskNotes: [{ taskId: `task-${id}`, note: 'Checkout button was below the fold.' }],
  },
  studyId: `s-${id}`,
  studyTitle: title,
  builderStatus: 'suspended',
  reason: 'builder_inactive',
  tasks: [{ id: `task-${id}`, order: 0, instruction: 'Buy the item and reach the receipt screen' }],
});

describe('Stuck (triage queue)', () => {
  /** The `stuck-builder_inactive` item showing `title` (the e2e's filter by testID and text). */
  const item = (title: string) => screen.getAllByTestId('stuck-builder_inactive').find((n) => within(n).queryByText(title))!;

  it('decides a non-oldest item from inside its own card', async () => {
    mockData.stuck.data = { items: [stuckItem('p1', 'Demo: checkout flow'), stuckItem('p2', 'Wallet onboarding')] };
    await render(tree(<Stuck />, client));
    await flush();
    expect(screen.getAllByTestId('stuck-approve')).toHaveLength(2);
    await fireEvent.press(within(item('Wallet onboarding')).getByTestId('stuck-approve'));
    await flush(500);
    expect(screen.getByText('Approve stuck submission?')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('stuck-reason'), 'Notes cover the task; the builder is suspended.');
    mockApi.mockResolvedValueOnce({ id: 'p2' });
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await flush(10);
    expect(mockApi).toHaveBeenCalledWith('adminDecide', { params: { id: 'p2' }, body: { decision: 'approve', reason: 'Notes cover the task; the builder is suspended.' } });
  });

  it('opens each sheet clean: a cancelled Reject reason never pre-fills the next Approve, and no stale failure shows', async () => {
    mockData.stuck.data = { items: [stuckItem('p1', 'Demo: checkout flow'), stuckItem('p2', 'Wallet onboarding')] };
    await render(tree(<Stuck />, client));
    await flush();
    await fireEvent.press(within(item('Demo: checkout flow')).getByTestId('stuck-reject'));
    await flush(500);
    await fireEvent.changeText(screen.getByTestId('stuck-reason'), 'No evidence for any of the tasks.');
    await failWith('Submission already decided');
    expect(screen.getByTestId('stuck-error')).toHaveTextContent(/Submission already decided/);
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await flush(500);
    await fireEvent.press(within(item('Wallet onboarding')).getByTestId('stuck-approve'));
    await flush(500);
    expect(screen.getByText('Approve stuck submission?')).toBeTruthy();
    expect(screen.getByTestId('stuck-reason').props.value).toBe('');
    // The 10-character gate is closed again: the old reason cannot pass it.
    expect(screen.getByTestId('confirm-ok')).toBeDisabled();
    expect(screen.queryByTestId('stuck-error')).toBeNull();
  });

  it('keeps the Approve title, confirm and tile while the sheet animates out after a success', async () => {
    mockData.stuck.data = { items: [stuckItem('p1', 'Demo: checkout flow')] };
    await render(tree(<Stuck />, client));
    await flush();
    await fireEvent.press(screen.getByTestId('stuck-approve'));
    await flush(500);
    await fireEvent.changeText(screen.getByTestId('stuck-reason'), 'Notes cover the task; the builder is suspended.');
    mockApi.mockResolvedValueOnce({ id: 'p1' });
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await flush(10);
    // target is null now; the leaving sheet still reads Approve, never Reject, and keeps its reason.
    expect(sheetText('Approve stuck submission?')).toBeTruthy();
    expect(sheetText('Reject stuck submission?')).toBeNull();
    expect(screen.getByTestId('confirm-ok', { includeHiddenElements: true })).toHaveTextContent('Approve');
    expect(screen.getByTestId('stuck-reason', { includeHiddenElements: true }).props.value).toBe('Notes cover the task; the builder is suspended.');
  });
});
