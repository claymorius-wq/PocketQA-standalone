import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import NewStudy from '../app/builder/new-study';

// New study (A-NewStudy): the form keeps its testIDs, copy and body; the wording notice and the
// "To save" hint share the dock's status rule; tasks fade out before they leave; Save draft
// sends the same body and replaces to the new draft.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
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

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockReset();
  mockApi.mockReset();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
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
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={qc}>
        <ThemeProvider fonts="system">
          <Scheme>
            <NewStudy />
          </Scheme>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await act(async () => setPreference?.(scheme));
  return r;
}

const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
/** Lets the mutation settle: react-query notifies on a 0ms timer, and the promise resolves between ticks. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => void (await jest.advanceTimersByTimeAsync(10)));
}

async function fillValid() {
  await act(async () => fireEvent.changeText(screen.getByTestId('study-title'), 'Onboarding friction'));
  await act(async () => fireEvent.changeText(screen.getByTestId('study-objective'), 'Find where first-time users get stuck creating an account.'));
  await act(async () => fireEvent.changeText(screen.getByTestId('study-task-0'), 'Create an account and reach the home screen'));
}

describe('New study', () => {
  it.each<ThemePreference>(['dark', 'light'])('renders the form with every testID and the budget (%s)', async (scheme) => {
    await renderScreen(scheme);
    for (const id of ['new-study-screen', 'study-title', 'study-objective', 'study-build', 'study-task-0', 'study-add-task', 'crit-android', 'crit-ios', 'crit-web', 'crit-min-api', 'crit-langs', 'study-reward', 'study-slots', 'study-consent', 'study-save']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId('study-budget')).toHaveTextContent('250');
    expect(screen.getByText('Budget to reserve at publish:')).toBeTruthy();
    // A fresh form cannot be saved and says why.
    expect(screen.getByTestId('study-save')).toBeDisabled();
    expect(screen.getByTestId('study-form-hint')).toHaveTextContent(/^To save: title — /);
    expect(screen.queryByTestId('copy-issue')).toBeNull();
  });

  it('shows the wording notice instead of the hint, and lets it leave in place', async () => {
    await renderScreen();
    await act(async () => fireEvent.changeText(screen.getByTestId('study-objective'), 'Earn money fast while testing our app'));
    expect(screen.getByTestId('copy-issue')).toHaveTextContent(/Remove promises of earnings, payment or AI analysis \(earn-money\)\./);
    // The hint steps aside for the notice (it leaves in place, 180ms).
    await advance(200);
    expect(screen.queryByTestId('study-form-hint')).toBeNull();
    await act(async () => fireEvent.changeText(screen.getByTestId('study-objective'), 'Find where first-time users get stuck creating an account.'));
    // It fades out over 180ms, then leaves the form.
    expect(screen.getByTestId('copy-issue')).toBeTruthy();
    await advance(200);
    expect(screen.queryByTestId('copy-issue')).toBeNull();
    expect(screen.getByTestId('study-form-hint')).toBeTruthy();
  });

  it('marks the field the linter or the schema rejects, never an empty one (§8)', async () => {
    await renderScreen();
    const DANGER = '#FF9A90';
    // Fresh form: Title and Objective are empty, so they are "not done yet", not wrong.
    expect(screen.getByText('TITLE')).not.toHaveStyle({ color: DANGER });
    expect(screen.getByText('OBJECTIVE')).not.toHaveStyle({ color: DANGER });
    await act(async () => fireEvent.changeText(screen.getByTestId('study-objective'), 'Earn money fast while testing our app'));
    expect(screen.getByText('OBJECTIVE')).toHaveStyle({ color: DANGER });
    expect(screen.getByText('TITLE')).not.toHaveStyle({ color: DANGER });
    await act(async () => fireEvent.changeText(screen.getByTestId('study-title'), 'ab'));
    expect(screen.getByText('TITLE')).toHaveStyle({ color: DANGER });
    await act(async () => fireEvent.changeText(screen.getByTestId('study-task-0'), 'Tap'));
    expect(screen.getByText('TASK 1')).toHaveStyle({ color: DANGER });
    await act(async () => fireEvent.changeText(screen.getByTestId('study-slots'), '0'));
    expect(screen.getByText('SLOTS')).toHaveStyle({ color: DANGER });
    expect(screen.getByText('REWARD PER TESTER')).not.toHaveStyle({ color: DANGER });
    await fillValid();
    for (const label of ['TITLE', 'OBJECTIVE', 'TASK 1']) expect(screen.getByText(label)).not.toHaveStyle({ color: DANGER });
  });

  it('adds tasks and removes one after its exit fade', async () => {
    await renderScreen();
    expect(screen.queryByText('Remove task')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('study-add-task')));
    expect(screen.getByTestId('study-task-1')).toBeTruthy();
    expect(screen.getAllByText('Remove task')).toHaveLength(2);
    await act(async () => fireEvent.press(screen.getAllByText('Remove task')[1]!));
    expect(screen.getByTestId('study-task-1')).toBeTruthy();
    await advance(200);
    expect(screen.queryByTestId('study-task-1')).toBeNull();
    expect(screen.queryByText('Remove task')).toBeNull();
  });

  it('hides Minimum Android API with Android, and ticks the budget', async () => {
    await renderScreen();
    await act(async () => fireEvent.press(screen.getByTestId('crit-android')));
    expect(screen.queryByTestId('crit-min-api')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('crit-android')));
    expect(screen.getByTestId('crit-min-api')).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId('study-slots'), '2'));
    expect(screen.getByTestId('study-budget')).toHaveTextContent('100');
  });

  it('saves the same body and replaces to the new draft', async () => {
    mockApi.mockResolvedValue({ id: 'study-9' });
    await renderScreen();
    await fillValid();
    await act(async () => fireEvent.press(screen.getByTestId('crit-web')));
    await advance(200);
    expect(screen.queryByTestId('study-form-hint')).toBeNull();
    expect(screen.getByTestId('study-save')).toBeEnabled();
    await act(async () => fireEvent.press(screen.getByTestId('study-save')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('createStudy', {
      body: {
        title: 'Onboarding friction',
        objective: 'Find where first-time users get stuck creating an account.',
        tasks: [{ instruction: 'Create an account and reach the home screen' }],
        deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: 29, languages: ['en'] },
        rewardCredits: 50,
        slots: 5,
        consentText: expect.stringMatching(/^I agree to record my screen/),
      },
    });
    expect(mockReplace).toHaveBeenCalledWith('/builder/study/study-9');
  });

  it('shows the server failure above the dock', async () => {
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockRejectedValue(new ApiError('INSUFFICIENT_CREDITS', 'Not enough test credits.'));
    await renderScreen();
    await fillValid();
    await act(async () => fireEvent.press(screen.getByTestId('study-save')));
    await settle();
    expect(screen.getByTestId('create-error')).toHaveTextContent(/Couldn’t save.*Not enough test credits\./);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
