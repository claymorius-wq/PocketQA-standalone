import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { budgetSlots } from '../src/screens/BuilderStudyBudget';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import { PASS_LEAVE_AFTER, PASS_MIN_AFTER_PRESS } from '../src/ui/patterns';
import BuilderStudy from '../app/builder/study/[id]';

// Builder study (A-BStudy): every testID, label and flow of the pre-Lens screen, the dock's
// action pairs per status, and U7 on Publish (the sheet holds through the Commit pass, then
// leaves; reduced motion closes it at once).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ id: 'study-1' }),
  Redirect: () => null,
}));
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: { id: 'b1', role: 'builder' } }) }));

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

type Participation = { id: string; testerDisplayName: string | null; status: string; consentedAt: string; submittedAt: string | null };
type Dispute = { id: string; participationId: string; status: string; reason: string; outcome: string | null; resolutionNote: string | null; createdAt: string };
let mockStudy: Record<string, unknown>;
let mockParts: Participation[];
let mockDisputes: Dispute[];
// The study is a real query (seeded), so the mutation's setQueryData shows on screen as in the app.
jest.mock('../src/lib/queries', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    useStudy: (id: string) => useQuery({ queryKey: ['study', id], queryFn: async () => mockStudy, initialData: mockStudy, staleTime: Infinity }),
    useStudyParticipations: () => ({ isLoading: false, error: null, data: { items: mockParts }, refetch: jest.fn() }),
    useStudyDisputes: () => ({ isLoading: false, error: null, data: { items: mockDisputes }, refetch: jest.fn() }),
  };
});

function study(over: Record<string, unknown> = {}) {
  return {
    id: 'study-1',
    builderId: 'b1',
    title: 'Demo: checkout flow',
    objective: 'See whether new users can find the checkout button and reach the receipt screen.',
    status: 'draft',
    moderation: 'ok',
    rewardCredits: 50,
    slots: 5,
    slotsFilled: 0,
    budget: { reserved: 0, awarded: 0, committed: 0, available: 0 },
    tasks: [
      { id: 't1', instruction: 'Add any item to the cart and open checkout', successCriteria: null },
      { id: 't2', instruction: 'Reach the receipt screen and note anything confusing', successCriteria: null },
    ],
    ...over,
  };
}
const PUBLISHED = { status: 'published', slotsFilled: 1, budget: { reserved: 250, awarded: 0, committed: 50, available: 200 } };

let reduced = false;
beforeEach(() => {
  jest.useFakeTimers();
  reduced = false;
  mockPush.mockReset();
  mockApi.mockReset();
  mockStudy = study();
  mockParts = [];
  mockDisputes = [];
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
            <BuilderStudy />
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
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

/** The settle wrapper around a budget figure: its nearest host ancestor that rises (translateY). */
type Node = { type: unknown; parent: Node | null; props: { style?: unknown } };
function settlePose(testID: string) {
  // The figure itself settles (KeyFigure / KeyValue valueStyle); look from the figure up.
  let n: Node | null = screen.getByTestId(testID) as unknown as Node;
  while (n) {
    if (typeof n.type === 'string') {
      const v = getAnimatedStyle(n as unknown as Parameters<typeof getAnimatedStyle>[0]) as unknown as { opacity?: number; transform?: { translateY?: number }[] };
      const y = v?.transform?.find((t) => t.translateY !== undefined);
      if (y && v.opacity !== undefined) return { opacity: v.opacity, y: y.translateY };
    }
    n = n.parent;
  }
  throw new Error(`no settle wrapper above ${testID}`);
}

describe('budgetSlots (the Budget card meter)', () => {
  it('splits the reserve into slots: one slot is one reward', () => {
    expect(budgetSlots({ rewardCredits: 50, slots: 5, budget: { reserved: 250, awarded: 50, committed: 50, available: 150 } })).toEqual({ awarded: 1, committed: 1, available: 3, kind: 'pips' });
  });
  it('never shows more than the slots, and uses one bar above 10 slots', () => {
    expect(budgetSlots({ rewardCredits: 10, slots: 3, budget: { reserved: 30, awarded: 40, committed: 10, available: 10 } })).toEqual({ awarded: 3, committed: 0, available: 0, kind: 'pips' });
    expect(budgetSlots({ rewardCredits: 10, slots: 40, budget: { reserved: 400, awarded: 100, committed: 50, available: 250 } }).kind).toBe('bar');
  });
});

describe('builder study (A-BStudy)', () => {
  it('draft: the header, the Budget card figures, the tasks, empty participants and disputes, and Close + Publish in the dock', async () => {
    await renderScreen();
    expect(screen.getByTestId('builder-study-screen')).toBeTruthy();
    expect(screen.getByTestId('study-status')).toHaveTextContent('DRAFT');
    expect(screen.getByText('Demo: checkout flow')).toBeTruthy();
    expect(screen.getByTestId('budget-card')).toBeTruthy();
    expect(screen.getByText('BUDGET · TEST CREDITS')).toBeTruthy();
    expect(screen.getByTestId('budget-reserved')).toHaveTextContent('0');
    expect(screen.getByTestId('budget-awarded')).toHaveTextContent('0');
    expect(screen.getByTestId('budget-available')).toHaveTextContent('0');
    // Nothing is reserved yet: the meter shows the draft's slots as bare sockets.
    expect(screen.getByTestId('budget-meter', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Add any item to the cart and open checkout')).toBeTruthy();
    expect(screen.getByText('No testers yet')).toBeTruthy();
    expect(screen.getByText('Publish the study so matching testers can join.')).toBeTruthy();
    expect(screen.getByTestId('study-disputes')).toBeTruthy();
    expect(screen.getByTestId('study-disputes-empty')).toHaveTextContent('No disputes on this study.');
    expect(screen.getByTestId('study-publish')).toBeTruthy();
    expect(screen.getByTestId('study-close')).toBeTruthy();
    expect(screen.queryByTestId('study-pause')).toBeNull();
    expect(screen.queryByTestId('study-resume')).toBeNull();
  });

  it('published: grouped figures, the bar meter over 10 slots, participant rows that open Review, a dispute card, and Close + Pause', async () => {
    mockStudy = study({ ...PUBLISHED, moderation: 'suspended', budget: { reserved: 1250, awarded: 1000, committed: 50, available: 200 }, slots: 25, rewardCredits: 50 });
    mockParts = [{ id: 'p1', testerDisplayName: 'Demo Tester', status: 'submitted', consentedAt: '2026-10-03T13:00:00Z', submittedAt: '2026-10-03T14:05:00Z' }];
    mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'open', reason: 'My note explains the checkout button problem.', outcome: null, resolutionNote: null, createdAt: '2026-10-03T16:30:00Z' }];
    await renderScreen();
    expect(screen.getByTestId('study-status')).toHaveTextContent('PUBLISHED');
    expect(screen.getByText('SUSPENDED BY MODERATION')).toBeTruthy();
    expect(screen.getByTestId('budget-reserved')).toHaveTextContent('1,250');
    expect(screen.getByTestId('budget-awarded')).toHaveTextContent('1,000');
    expect(screen.getByTestId('budget-available')).toHaveTextContent('200');
    // 25 slots: the continuous bar.
    expect(screen.getByTestId('budget-meter', { includeHiddenElements: true })).toBeTruthy();
    const row = screen.getByTestId('builder-participation-p1');
    expect(row.props.accessibilityLabel).toBe('Review Demo Tester');
    expect(screen.getByText('AWAITING REVIEW')).toBeTruthy();
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/builder/review/p1');
    const dispute = screen.getByTestId('study-dispute-open');
    expect(dispute.props.accessibilityLabel).toBe('Open disputed participation');
    expect(screen.getByText('Waiting for an admin.')).toBeTruthy();
    await fireEvent.press(dispute);
    expect(mockPush).toHaveBeenLastCalledWith('/builder/review/p1');
    expect(screen.queryByTestId('study-disputes-empty')).toBeNull();
    expect(screen.getByTestId('study-pause')).toBeTruthy();
    expect(screen.getByTestId('study-close')).toBeTruthy();
    expect(screen.queryByTestId('study-publish')).toBeNull();
  });

  it('a resolved dispute leads with its outcome, then the admin note', async () => {
    mockStudy = study(PUBLISHED);
    mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'resolved', reason: 'Reason text here.', outcome: 'upheld', resolutionNote: 'No evidence shows the receipt screen.', createdAt: '2026-10-03T16:30:00Z' }];
    await renderScreen();
    expect(screen.getByTestId('study-dispute-resolved')).toBeTruthy();
    expect(screen.getByText('Upheld: your rejection stands.', { exact: false })).toBeTruthy();
    expect(screen.getByText(/No evidence shows the receipt screen\./)).toBeTruthy();
  });

  it('paused offers Resume; a closed study has no actions', async () => {
    mockStudy = study({ ...PUBLISHED, status: 'paused' });
    const r = await renderScreen();
    expect(screen.getByTestId('study-resume')).toBeTruthy();
    expect(screen.queryByTestId('study-pause')).toBeNull();
    await r.unmount();
    mockStudy = study({ ...PUBLISHED, status: 'closed' });
    await renderScreen();
    expect(screen.queryByTestId('study-close')).toBeNull();
    expect(screen.queryByTestId('study-resume')).toBeNull();
  });

  it('signature: the budget figures settle on the push, Reserved first and Available last', async () => {
    mockStudy = study(PUBLISHED);
    await renderScreen();
    expect(settlePose('budget-reserved')).toEqual({ opacity: 0, y: 6 });
    expect(settlePose('budget-available')).toEqual({ opacity: 0, y: 6 });
    // Reserved has landed (+160 + 320) while Available (+280) is still on its way.
    await advance(500);
    expect(settlePose('budget-reserved')).toEqual({ opacity: 1, y: 0 });
    expect(settlePose('budget-available').opacity).toBeLessThan(1);
    await advance(200);
    expect(settlePose('budget-available')).toEqual({ opacity: 1, y: 0 });
  });

  it('reduced motion: the budget figures are simply there', async () => {
    reduced = true;
    mockStudy = study(PUBLISHED);
    await renderScreen();
    // One frame: the OS setting arrives asynchronously, and the figures' style follows it on the next frame.
    await advance(16);
    expect(settlePose('budget-reserved')).toEqual({ opacity: 1, y: 0 });
    expect(settlePose('budget-available')).toEqual({ opacity: 1, y: 0 });
  });

  it('U7: Publish holds its sheet, locked, through the Commit pass, then leaves; the dock swaps to Pause', async () => {
    mockApi.mockImplementation(async (route: string) => (route === 'publishStudy' ? study(PUBLISHED) : null));
    await renderScreen();
    await fireEvent.press(screen.getByTestId('study-publish'));
    expect(screen.getByText('Publish this study?')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-ok'));
    });
    await settle();
    expect(mockApi).toHaveBeenCalledWith('publishStudy', { params: { id: 'study-1' } });
    expect(screen.getByTestId('study-status')).toHaveTextContent('PUBLISHED');
    // Mid-pass: the sheet is still up and neither action can fire or close it.
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: true });
    await advance(PASS_MIN_AFTER_PRESS + PASS_LEAVE_AFTER + 50);
    // The sheet leaves (its 240ms exit), and the Budget card takes the tail.
    await advance(400);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(screen.getByTestId('budget-reserved')).toHaveTextContent('250');
    expect(screen.getByTestId('study-pause')).toBeTruthy();
    expect(screen.queryByTestId('study-publish')).toBeNull();
  });

  it('reduced motion: Publish closes its sheet as soon as the request succeeds', async () => {
    reduced = true;
    mockApi.mockImplementation(async () => study(PUBLISHED));
    await renderScreen();
    await fireEvent.press(screen.getByTestId('study-publish'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-ok'));
    });
    await settle();
    await advance(300);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(screen.getByTestId('study-pause')).toBeTruthy();
  });

  it('a failed Close keeps the sheet open with the server message, and shows it over the dock', async () => {
    mockStudy = study(PUBLISHED);
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockImplementation(async () => {
      throw new ApiError('CONFLICT', 'A rejected tester can still dispute (7-day dispute window). Close the study after the window ends.');
    });
    await renderScreen();
    await fireEvent.press(screen.getByTestId('study-close'));
    expect(screen.getByText('Close this study?')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-ok'));
    });
    await settle();
    await advance(50);
    expect(mockApi).toHaveBeenCalledWith('closeStudy', { params: { id: 'study-1' } });
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
    expect(screen.getByTestId('study-action-sheet-error')).toHaveTextContent(/dispute window/);
    expect(screen.getByTestId('study-action-error')).toHaveTextContent(/dispute window/);
    // Cancel still closes after a failure.
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-cancel'));
    });
    await advance(400);
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
  });

  it('opens each sheet clean: a failed Close never shows (or announces) its error in the next sheet', async () => {
    mockStudy = study(PUBLISHED);
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockImplementation(async () => {
      throw new ApiError('CONFLICT', 'A rejected tester can still dispute (7-day dispute window). Close the study after the window ends.');
    });
    await renderScreen();
    await fireEvent.press(screen.getByTestId('study-close'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-ok'));
    });
    await settle();
    await advance(50);
    expect(screen.getByTestId('study-action-sheet-error')).toHaveTextContent(/dispute window/);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-cancel'));
    });
    await advance(400);
    // The failure stays over the dock until the next sheet opens; that sheet starts clean.
    expect(screen.getByTestId('study-action-error')).toHaveTextContent(/dispute window/);
    await fireEvent.press(screen.getByTestId('study-pause'));
    expect(screen.getByText('Pause this study?')).toBeTruthy();
    expect(screen.queryByTestId('study-action-sheet-error')).toBeNull();
    expect(screen.queryByTestId('study-action-error')).toBeNull();
  });

  it('keeps the Close title and confirm while the sheet animates out after Cancel', async () => {
    mockStudy = study(PUBLISHED);
    await renderScreen();
    await fireEvent.press(screen.getByTestId('study-close'));
    await advance(500);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirm-cancel'));
    });
    await advance(10);
    // Still leaving (240ms): nothing is selected any more, and the sheet still reads Close.
    expect(screen.getByTestId('confirm-sheet', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Close this study?', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('confirm-ok', { includeHiddenElements: true })).toHaveTextContent('Close study');
    await advance(400);
    expect(screen.queryByTestId('confirm-sheet', { includeHiddenElements: true })).toBeNull();
  });

  it('light theme renders the same screen flat', async () => {
    mockStudy = study(PUBLISHED);
    await renderScreen('light');
    expect(screen.getByTestId('budget-card')).toBeTruthy();
    expect(screen.getByTestId('budget-meter', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('study-pause')).toBeTruthy();
  });
});
