import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Participation } from '@pocket-qa/contracts';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import Work from '../app/(tester)/work';

// My work (A-Work): the cards keep every testID, label and copy string; the reward sits in the
// lens well; a status change swaps only the pill; a list that changes after arrival rises in.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (to: string) => mockPush(to) }, useFocusEffect: () => undefined }));

type Q = { isLoading: boolean; error: unknown; data: { items: Participation[] } | undefined; refetch: () => unknown };
let mockQuery: Q;
jest.mock('../src/lib/queries', () => ({ useMyParticipations: () => mockQuery, useFocusRefetch: () => undefined }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

function participation(id: string, over: Partial<Participation> = {}): Participation {
  return {
    id,
    studyId: 's1',
    testerId: 't1',
    testerDisplayName: null,
    status: 'submitted',
    consentVersion: 1,
    consentedAt: '2026-10-03T14:03:00.000Z',
    startedAt: null,
    submittedAt: null,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    rewardCredits: 50,
    reward: { kind: 'test_credits', credits: 50 },
    payoutAddress: null,
    payout: null,
    taskNotes: [],
    ...over,
  };
}

const loaded = (items: Participation[]): Q => ({ isLoading: false, error: null, data: { items }, refetch: jest.fn() });

let setPreference: ((p: ThemePreference) => void) | undefined;
function Scheme({ children }: { children: ReactNode }) {
  setPreference = useTheme().setPreference;
  return <>{children}</>;
}
const tree = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">
      <Scheme>
        <Work />
      </Scheme>
    </ThemeProvider>
  </SafeAreaProvider>
);

async function renderWork(scheme: ThemePreference) {
  const r = await render(tree());
  await act(async () => setPreference?.(scheme));
  return r;
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each<ThemePreference>(['dark', 'light'])('My work in %s', (scheme) => {
  it('renders each session card with its testIDs, label, pill, joined date and reward well', async () => {
    mockQuery = loaded([participation('p1', { status: 'in_progress', rewardCredits: 30 }), participation('p2', { rewardCredits: 1 })]);
    await renderWork(scheme);
    expect(screen.getByTestId('work-screen')).toBeTruthy();
    expect(screen.getByText('My work')).toBeTruthy();
    expect(screen.getByText('Sessions you’ve joined')).toBeTruthy();

    const card = screen.getByTestId('participation-card-p1');
    expect(card.props.accessibilityLabel).toBe('Open session');
    expect(card.props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('participation-status-p1')).toBeTruthy();
    expect(screen.getByText('IN PROGRESS')).toBeTruthy();
    expect(screen.getByText('AWAITING REVIEW')).toBeTruthy();
    expect(screen.getAllByText(/^Joined /)).toHaveLength(2);
    // One stop per card: the hint reads the status, the joined date and the reward as one phrase
    // (the same words as before, "30 test credits if approved").
    expect(card.props.accessibilityHint).toMatch(/^In progress\. Joined .+\. 30 test credits if approved\.$/);
    expect(screen.getByTestId('participation-card-p2').props.accessibilityHint).toMatch(/\. 1 test credit if approved\.$/);

    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith('/participation/p1');
  });

  it('shows the empty state with Find studies, which opens Discover', async () => {
    mockQuery = loaded([]);
    await renderWork(scheme);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.getByText('Join a study from Discover to start a session.')).toBeTruthy();
    fireEvent.press(screen.getByText('Find studies'));
    expect(mockPush).toHaveBeenCalledWith('/discover');
  });

  it('keeps the loading row and the error panel from the kit', async () => {
    mockQuery = { isLoading: true, error: null, data: undefined, refetch: jest.fn() };
    const r = await renderWork(scheme);
    expect(screen.getByText('Loading…')).toBeTruthy();
    const refetch = jest.fn();
    mockQuery = { isLoading: false, error: new Error('boom'), data: undefined, refetch };
    await r.rerender(tree());
    expect(screen.getByTestId('error-state')).toBeTruthy();
    fireEvent.press(screen.getByTestId('retry-button'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('My work motion', () => {
  const listOf = (id: string) => {
    let node = screen.getByTestId(`participation-card-${id}`).parent;
    // The NewContent wrapper is the nearest ancestor that carries the list gap.
    while (node && (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.gap !== 14) node = node.parent;
    return node!;
  };

  it('a status change on refetch swaps the pill in place; the card stays mounted and the list does not move', async () => {
    mockQuery = loaded([participation('p1')]);
    const r = await renderWork('dark');
    await advance(1000);
    const before = screen.getByTestId('participation-card-p1');
    mockQuery = loaded([participation('p1', { status: 'approved' })]);
    await r.rerender(tree());
    expect(screen.getByTestId('participation-card-p1')).toBe(before);
    expect(screen.getByText('APPROVED')).toBeTruthy();
    expect(screen.queryByText('AWAITING REVIEW')).toBeNull();
    expect(listOf('p1')).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('a list that changes after the arrival rises in as new content', async () => {
    mockQuery = loaded([participation('p1')]);
    const r = await renderWork('dark');
    await advance(1000);
    mockQuery = loaded([participation('p2'), participation('p1')]);
    await r.rerender(tree());
    expect(listOf('p2')).toHaveAnimatedStyle({ opacity: 0 });
    await advance(400);
    expect(listOf('p2')).toHaveAnimatedStyle({ opacity: 1 });
  });
});
