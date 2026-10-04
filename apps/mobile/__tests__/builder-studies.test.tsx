import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Study } from '@pocket-qa/contracts';
import Studies from '../app/(builder)/studies';
import { awardedSlots, studyCardK } from '../src/screens/BuilderStudyCard';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';

// Jest resolves lucide's "react-native" export to an ES-module build the jest-expo transform does
// not compile; its CommonJS build is the same set of components (as in ui.test.tsx).
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
type Q = { isLoading: boolean; error: unknown; data: { items: Study[] } | undefined; refetch: () => unknown };
let mockQuery: Q;
jest.mock('../src/lib/queries', () => ({ useStudies: () => mockQuery, useFocusRefetch: () => undefined }));

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
async function renderIn(scheme: ThemePreference) {
  const r = await render(wrap(<Studies />));
  await act(async () => setPreference?.(scheme));
  return r;
}
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

function study(over: Partial<Study> & Pick<Study, 'id' | 'title'>): Study {
  return {
    builderId: 'b1',
    objective: 'Find friction in the first run.',
    tasks: [],
    deviceCriteria: { platforms: ['android'], minAndroidApi: null, languages: [] },
    rewardCredits: 30,
    payment: { mode: 'test_credits' },
    reward: { kind: 'test_credits', credits: 30 },
    slots: 5,
    consentText: 'You agree to record your screen for this study.',
    consentVersion: 1,
    status: 'published',
    moderation: 'ok',
    budget: { reserved: 150, awarded: 0, committed: 0, available: 150 },
    slotsFilled: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    publishedAt: '2026-10-01T10:00:00.000Z',
    closedAt: null,
    ...over,
  } as Study;
}

const ITEMS = [
  study({ id: 's1', title: 'Demo: onboarding screens' }),
  study({ id: 's2', title: 'Onboarding friction', moderation: 'suspended', slotsFilled: 1, budget: { reserved: 150, awarded: 0, committed: 30, available: 120 } }),
  study({ id: 's3', title: 'Big study', slots: 50, slotsFilled: 12, budget: { reserved: 1500, awarded: 210, committed: 150, available: 1140 } }),
];
const loaded = (items: Study[]): Q => ({ isLoading: false, error: null, data: { items }, refetch: jest.fn() });

/** The opacity of the nearest animated wrapper above a node (the card's Enter step). */
function enterOpacity(node: { parent: unknown }): number | undefined {
  let n = node.parent as { parent: unknown; type: unknown } | null;
  while (n) {
    if (typeof n.type === 'string') {
      try {
        const s = getAnimatedStyle(n as never) as { opacity?: number } | undefined;
        if (s && typeof s.opacity === 'number') return s.opacity;
      } catch {
        // not an animated host
      }
    }
    n = n.parent as typeof n;
  }
  return undefined;
}

describe('builder studies data rules', () => {
  it('cards dim down the list (1, 0.8, 0.64, 0.51) and a closed study one step more', () => {
    expect([0, 1, 2, 3, 6].map((i) => studyCardK(i, 'published'))).toEqual([1, 0.8, 0.64, 0.512, 0.512]);
    expect(studyCardK(3, 'closed')).toBeCloseTo(0.328, 3);
    expect(studyCardK(0, 'draft')).toBe(1);
  });

  it('awarded slots come from the awarded credits, never more than the slots taken', () => {
    expect(awardedSlots({ rewardCredits: 30, slotsFilled: 12, budget: { reserved: 0, awarded: 210, committed: 0, available: 0 } })).toBe(7);
    expect(awardedSlots({ rewardCredits: 30, slotsFilled: 1, budget: { reserved: 0, awarded: 90, committed: 0, available: 0 } })).toBe(1);
    expect(awardedSlots({ rewardCredits: 30, slotsFilled: 2, budget: { reserved: 0, awarded: 0, committed: 0, available: 0 } })).toBe(0);
  });
});

describe.each<ThemePreference>(['dark', 'light'])('Studies (%s)', (scheme) => {
  it('keeps the screen, card and status testIDs, the labels and the navigation', async () => {
    mockQuery = loaded(ITEMS);
    await renderIn(scheme);
    expect(screen.getByTestId('studies-screen')).toBeTruthy();
    expect(screen.getByText('Studies')).toBeTruthy();
    expect(screen.getByText('Your usability studies')).toBeTruthy();
    for (const s of ITEMS) {
      expect(screen.getByTestId(`builder-study-${s.id}`).props.accessibilityLabel).toBe(`Open study ${s.title}`);
    }
    expect(screen.getAllByTestId('builder-study-status')).toHaveLength(3);
    expect(screen.getByText('SUSPENDED BY MODERATION')).toBeTruthy();
    // The slot meter reads the counts; the reward and the available credits sit beside it.
    expect(screen.getByLabelText('1 of 5 slots filled')).toBeTruthy();
    expect(screen.getByLabelText('12 of 50 slots filled')).toBeTruthy();
    expect(screen.getAllByText('30 test credits each')).toHaveLength(3);
    expect(screen.getByText('1,140')).toBeTruthy();
    expect(screen.getAllByText('available')).toHaveLength(3);

    await fireEvent.press(screen.getByTestId('builder-study-s2'));
    expect(mockPush).toHaveBeenLastCalledWith('/builder/study/s2');
    await fireEvent.press(screen.getByTestId('new-study'));
    expect(mockPush).toHaveBeenLastCalledWith('/builder/new-study');
  });

  it('empty: the panel with the secondary "Create a study" action', async () => {
    mockQuery = loaded([]);
    await renderIn(scheme);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No studies yet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('empty-new-study'));
    expect(mockPush).toHaveBeenLastCalledWith('/builder/new-study');
  });

  it('loading and offline use the kit states', async () => {
    mockQuery = { isLoading: true, error: null, data: undefined, refetch: jest.fn() };
    const r = await renderIn(scheme);
    expect(screen.getByText('Loading…')).toBeTruthy();
    const { ApiError } = jest.requireActual<typeof import('../src/api/client')>('../src/api/client');
    const refetch = jest.fn();
    mockQuery = { isLoading: false, error: new ApiError('OFFLINE', 'offline', 0), data: undefined, refetch };
    await r.rerender(wrap(<Studies />));
    expect(screen.getByTestId('offline-state')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retry-button'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('Studies signature: cards stagger', () => {
  it('a list that is there when the screen arrives moves with the screen, not card by card', async () => {
    mockQuery = loaded(ITEMS);
    await renderIn('dark');
    expect(enterOpacity(screen.getByTestId('builder-study-s1'))).toBe(1);
    expect(enterOpacity(screen.getByTestId('builder-study-s3'))).toBe(1);
  });

  it('a list that arrives later (first load, Retry) rises card by card, 40ms apart', async () => {
    mockQuery = { isLoading: true, error: null, data: undefined, refetch: jest.fn() };
    const r = await renderIn('dark');
    await advance(1000);
    mockQuery = loaded(ITEMS);
    await r.rerender(wrap(<Studies />));
    await advance(0);
    expect(enterOpacity(screen.getByTestId('builder-study-s1'))).toBe(0);
    // Step 0 starts at 80ms, step 2 at 160ms, each 320ms long.
    await advance(420);
    expect(enterOpacity(screen.getByTestId('builder-study-s1'))).toBe(1);
    expect(enterOpacity(screen.getByTestId('builder-study-s3'))!).toBeLessThan(1);
    await advance(200);
    expect(enterOpacity(screen.getByTestId('builder-study-s3'))).toBe(1);
  });
});
