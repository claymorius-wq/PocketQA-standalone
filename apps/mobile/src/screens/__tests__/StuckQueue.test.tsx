import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { StuckSubmission } from '@pocket-qa/contracts';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { reasonLabel, splitQueue, StuckQueue, stuckAge } from '../StuckQueue';

// A-Stuck (CONSISTENCY D2): the oldest stuck submission is the focus card, the rest are "Next in
// queue" items. As on main, every item is fully actionable in place: its own stuck-<reason> node
// holds its Review work, Reject and Approve (e2e remaining-scope clicks inside the filtered item).
// S8 files a decided card away before the next one takes the slot. The work stays behind "Review
// work" (lazy evidence fetch).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockEvidence = jest.fn();
jest.mock('../../lib/queries', () => ({
  useEvidence: (id: string, enabled: boolean) => mockEvidence(id, enabled),
}));
// The evidence item (playback via expo-video) is the Review screen's; only its presence matters here.
jest.mock('../../evidence/EvidenceItem', () => ({ EvidenceItem: () => null }));
jest.mock('../../api/client', () => {
  class ApiError extends Error {
    code = 'X';
  }
  return { ApiError, api: jest.fn(), mediaUrl: (t: string) => t };
});

beforeEach(() => {
  jest.useFakeTimers();
  mockEvidence.mockReset();
  mockEvidence.mockImplementation((_id: string, enabled: boolean) => ({ isLoading: false, error: null, data: enabled ? { items: [] } : undefined, refetch: jest.fn() }));
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
const wrap = (ui: ReactNode) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">
      <Scheme>{ui}</Scheme>
    </ThemeProvider>
  </SafeAreaProvider>
);

const DAY = 86_400_000;
function stuck(id: string, title: string, reason: 'builder_inactive' | 'overdue', submittedAt: string, builderStatus: 'active' | 'suspended' | 'deleted' = 'suspended'): StuckSubmission {
  return {
    participation: {
      id,
      studyId: `s-${id}`,
      testerId: 't1',
      testerDisplayName: 'Tara Tester',
      status: 'submitted',
      consentVersion: 1,
      consentedAt: submittedAt,
      startedAt: submittedAt,
      submittedAt,
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      rewardCredits: 50,
      taskNotes: [{ taskId: `task-${id}`, note: 'Checkout button was below the fold.' }],
    },
    studyId: `s-${id}`,
    studyTitle: title,
    builderStatus: reason === 'overdue' ? 'active' : builderStatus,
    reason,
    tasks: [{ id: `task-${id}`, order: 0, instruction: 'Buy the item and reach the receipt screen' }],
  } as unknown as StuckSubmission;
}

const OLD = stuck('p1', 'Demo: checkout flow', 'overdue', '2026-09-25T16:18:00.000Z');
const MID = stuck('p2', 'Native recording', 'builder_inactive', '2026-09-30T09:05:00.000Z', 'deleted');
const NEW = stuck('p3', 'Wallet onboarding', 'builder_inactive', '2026-10-01T11:42:00.000Z');

describe('stuck queue helpers', () => {
  it('labels the reason the way the pill always has', () => {
    expect(reasonLabel(OLD)).toBe('Overdue');
    expect(reasonLabel(MID)).toBe('Builder deleted');
    expect(reasonLabel(NEW)).toBe('Builder suspended');
  });
  it('reads the wait as whole days', () => {
    const at = Date.parse('2026-10-03T12:00:00.000Z');
    expect(stuckAge('2026-09-25T16:18:00.000Z', at)).toBe('7 days');
    expect(stuckAge(new Date(at - DAY).toISOString(), at)).toBe('1 day');
    expect(stuckAge(new Date(at - 1000).toISOString(), at)).toBe('0 days');
    expect(stuckAge(null, at)).toBeNull();
  });
  it('focuses the oldest, keeping the API order for the rest', () => {
    expect(splitQueue([OLD, MID, NEW])).toEqual({ focus: OLD, rest: [MID, NEW] });
    expect(splitQueue([MID])).toEqual({ focus: MID, rest: [] });
    expect(splitQueue([])).toEqual({ focus: null, rest: [] });
  });
});

/** Every rendered `stuck-<reason>` node, focus card first. */
const items = () => [...screen.queryAllByTestId('stuck-overdue'), ...screen.queryAllByTestId('stuck-builder_inactive')];

describe('StuckQueue', () => {
  it('shows the oldest as the focus card and the rest under "Next in queue", each with its own actions (main: one set per item)', async () => {
    await render(wrap(<StuckQueue items={[OLD, MID, NEW]} decided={null} onDecide={jest.fn()} />));
    const card = screen.getByTestId('stuck-overdue');
    expect(within(card).getByText('Demo: checkout flow')).toBeTruthy();
    expect(within(card).getByText('OVERDUE')).toBeTruthy();
    expect(screen.getByText('NEXT IN QUEUE')).toBeTruthy();
    // One Review work / Reject / Approve set per item, as on main: three items, three sets.
    expect(screen.getAllByTestId('stuck-review')).toHaveLength(3);
    expect(screen.getAllByTestId('stuck-approve')).toHaveLength(3);
    expect(screen.getAllByTestId('stuck-reject')).toHaveLength(3);
    expect(items()).toHaveLength(3);
    for (const item of items()) {
      expect(within(item).getAllByTestId('stuck-review')).toHaveLength(1);
      expect(within(item).getAllByTestId('stuck-approve')).toHaveLength(1);
      expect(within(item).getAllByTestId('stuck-reject')).toHaveLength(1);
    }
    // Each queue item keeps main's copy: its pill, its submitted date and the tester's byline.
    const [mid, recent] = screen.getAllByTestId('stuck-builder_inactive');
    expect(within(mid!).getByText('Native recording')).toBeTruthy();
    expect(within(mid!).getByText('BUILDER DELETED')).toBeTruthy();
    expect(mid).toHaveTextContent(/Submitted/);
    expect(mid).toHaveTextContent(/Tara Tester · 50 test credits on approval · 1 note\(s\)/);
    expect(within(recent!).getByText('Wallet onboarding')).toBeTruthy();
    expect(within(mid!).getByText(stuckAge(MID.participation.submittedAt, Date.now())!)).toBeTruthy();
  });

  it('decides each item from inside its own stuck-<reason> node', async () => {
    const onDecide = jest.fn();
    await render(wrap(<StuckQueue items={[OLD, MID, NEW]} decided={null} onDecide={onDecide} />));
    await fireEvent.press(within(screen.getByTestId('stuck-overdue')).getByTestId('stuck-approve'));
    expect(onDecide).toHaveBeenLastCalledWith('p1', 'approve');
    const [mid, recent] = screen.getAllByTestId('stuck-builder_inactive');
    await fireEvent.press(within(mid!).getByTestId('stuck-reject'));
    expect(onDecide).toHaveBeenLastCalledWith('p2', 'reject');
    await fireEvent.press(within(recent!).getByTestId('stuck-approve'));
    expect(onDecide).toHaveBeenLastCalledWith('p3', 'approve');
    expect(onDecide).toHaveBeenCalledTimes(3);
  });

  it('opens the work of a non-oldest item in place, fetching only that item’s evidence (e2e remaining-scope)', async () => {
    await render(wrap(<StuckQueue items={[OLD, NEW]} decided={null} onDecide={jest.fn()} />));
    expect(mockEvidence).not.toHaveBeenCalledWith(expect.anything(), true);
    // The e2e filters the item by testID and text, then clicks inside it.
    const item = screen.getAllByTestId('stuck-builder_inactive').find((n) => within(n).queryByText('Wallet onboarding'))!;
    await fireEvent.press(within(item).getByTestId('stuck-review'));
    expect(mockEvidence).toHaveBeenCalledWith('p3', true);
    expect(mockEvidence).not.toHaveBeenCalledWith('p1', true);
    const work = within(screen.getAllByTestId('stuck-builder_inactive')[0]!).getByTestId('stuck-work');
    expect(within(work).getByText('Buy the item and reach the receipt screen')).toBeTruthy();
    expect(within(work).getByTestId('stuck-note-0').props.children).toBe('Checkout button was below the fold.');
    expect(within(work).getByTestId('stuck-no-evidence')).toBeTruthy();
    // The focus card's work stays closed.
    expect(within(screen.getByTestId('stuck-overdue')).queryByTestId('stuck-work')).toBeNull();
    expect(within(screen.getByTestId('stuck-overdue')).getByTestId('stuck-review')).toBeTruthy();
  });

  it('keeps the work behind Review work and fetches the evidence only once opened', async () => {
    await render(wrap(<StuckQueue items={[NEW]} decided={null} onDecide={jest.fn()} />));
    expect(mockEvidence).toHaveBeenLastCalledWith('p3', false);
    expect(screen.queryByTestId('stuck-work')).toBeNull();
    expect(screen.queryByText('NEXT IN QUEUE')).toBeNull();
    await fireEvent.press(screen.getByTestId('stuck-review'));
    expect(mockEvidence).toHaveBeenLastCalledWith('p3', true);
    const work = screen.getByTestId('stuck-work');
    expect(within(work).getByText('Buy the item and reach the receipt screen')).toBeTruthy();
    expect(screen.getByTestId('stuck-note-0').props.children).toBe('Checkout button was below the fold.');
    expect(screen.getByTestId('stuck-no-evidence')).toBeTruthy();
  });

  it('S8: holds the decided focus card while it sinks, then the next one takes the slot', async () => {
    const r = await render(wrap(<StuckQueue items={[OLD, MID]} decided={null} onDecide={jest.fn()} />));
    // The decision succeeded and the refetch already dropped the item.
    await r.rerender(wrap(<StuckQueue items={[MID]} decided={{ id: 'p1', n: 1 }} onDecide={jest.fn()} />));
    // Sealed: out of the accessibility tree and out of touch while it sinks.
    const sealed = screen.getByTestId('stuck-overdue', { includeHiddenElements: true });
    expect(sealed.props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByTestId('stuck-overdue')).toBeNull();
    // The queue item stays actionable meanwhile.
    expect(within(screen.getByTestId('stuck-builder_inactive')).getByTestId('stuck-approve')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(400));
    expect(screen.queryByTestId('stuck-overdue', { includeHiddenElements: true })).toBeNull();
    // The next item holds the focus slot (its queue copy is fading out, hidden).
    expect(screen.getAllByTestId('stuck-builder_inactive')).toHaveLength(1);
    expect(within(screen.getByTestId('stuck-builder_inactive')).getByText('Native recording')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(400));
    expect(screen.getAllByTestId('stuck-builder_inactive', { includeHiddenElements: true })).toHaveLength(1);
    expect(screen.queryByText('NEXT IN QUEUE')).toBeNull();
    expect(within(screen.getByTestId('stuck-builder_inactive')).getByTestId('stuck-approve')).toBeTruthy();
  });

  it('S8: files a decided card away even while the refetch still lists it', async () => {
    const r = await render(wrap(<StuckQueue items={[OLD, MID]} decided={null} onDecide={jest.fn()} />));
    await r.rerender(wrap(<StuckQueue items={[OLD, MID]} decided={{ id: 'p1', n: 1 }} onDecide={jest.fn()} />));
    await act(async () => jest.advanceTimersByTime(400));
    expect(screen.queryByTestId('stuck-overdue')).toBeNull();
    expect(screen.getByTestId('stuck-builder_inactive')).toBeTruthy();
  });

  it('a decided queue item leaves in place; the focus card and the other items keep their actions', async () => {
    const r = await render(wrap(<StuckQueue items={[OLD, MID, NEW]} decided={null} onDecide={jest.fn()} />));
    // The admin decided the middle item from its own card; the refetch still lists it.
    await r.rerender(wrap(<StuckQueue items={[OLD, MID, NEW]} decided={{ id: 'p2', n: 1 }} onDecide={jest.fn()} />));
    expect(screen.queryByText('Native recording')).toBeNull();
    await act(async () => jest.advanceTimersByTime(400));
    expect(screen.queryByText('Native recording', { includeHiddenElements: true })).toBeNull();
    expect(within(screen.getByTestId('stuck-overdue')).getByText('Demo: checkout flow')).toBeTruthy();
    expect(within(screen.getByTestId('stuck-builder_inactive')).getByText('Wallet onboarding')).toBeTruthy();
    expect(screen.getAllByTestId('stuck-approve')).toHaveLength(2);
    expect(screen.getAllByTestId('stuck-reject')).toHaveLength(2);
  });

  it.each<ThemePreference>(['dark', 'light'])('renders the focus card, the work well and the queue in %s', async (scheme) => {
    await render(wrap(<StuckQueue items={[OLD, NEW]} decided={null} onDecide={jest.fn()} />));
    await act(async () => setPreference?.(scheme));
    await fireEvent.press(within(screen.getByTestId('stuck-overdue')).getByTestId('stuck-review'));
    expect(screen.getByTestId('stuck-overdue')).toBeTruthy();
    expect(screen.getByTestId('stuck-work')).toBeTruthy();
    expect(within(screen.getByTestId('stuck-builder_inactive')).getByTestId('stuck-review')).toBeTruthy();
  });
});
