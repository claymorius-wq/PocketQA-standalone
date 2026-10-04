import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Participation } from '@pocket-qa/contracts';
import { ThemeProvider, useTheme, type ThemePreference } from '../src/theme/ThemeProvider';
import ParticipationScreen from '../app/participation/[id]';
import { stampArrival } from '../src/motion/entrance';
import { DUR } from '../src/theme/motion';

// Your session (A-Session): every status keeps its testIDs and copy; Start lives in the dock; the
// recorder, review-before-upload clips and upload keep their behaviour; Submit plays U4 (the In
// progress view holds for the Lock and the Commit pass, then "Awaiting review" replaces it).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ id: 'p1' }), Redirect: () => null }));
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: { id: 'u1', role: 'tester' }, features: { testCredits: true, devnetTransfers: true } }) }));

let mockCapability: { available: true } | { available: false; reason: string } = { available: true };
jest.mock('../src/lib/capability', () => ({ recordingCapability: () => mockCapability }));

type Recorder = { live: boolean; startAsync: jest.Mock; stopAsync: jest.Mock; isRecording: () => boolean; discardAsync: jest.Mock; purgeAsync: jest.Mock; addListener: jest.Mock };
const mockRecorder: Recorder = {
  live: false,
  startAsync: jest.fn(),
  stopAsync: jest.fn(),
  isRecording: () => mockRecorder.live,
  discardAsync: jest.fn(() => Promise.resolve()),
  purgeAsync: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};
jest.mock('../src/evidence/recorder', () => ({ nativeRecorder: () => mockRecorder }));
jest.mock('../src/evidence/MediaPreview', () => ({ MediaPreview: () => null }));
jest.mock('../src/wallet/TransferCard', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { TransferCard: () => <View testID="transfer-card" /> };
});
jest.mock('expo-file-system', () => ({ File: class { delete() {} } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const mockApi = jest.fn();
const mockUpload = jest.fn();
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, api: (...a: unknown[]) => mockApi(...a), uploadEvidence: (...a: unknown[]) => mockUpload(...a) };
});

type EvidenceItem = { id: string; kind: 'screen_recording' | 'screenshot'; mimeType: string; sizeBytes: number; createdAt: string };
type DisputeItem = { id: string; participationId: string; status: string; outcome: string | null; resolutionNote: string | null };
let mockParticipation: Participation;
let mockEvidence: EvidenceItem[] = [];
let mockDisputes: DisputeItem[] = [];
let mockFindings: { id: string; title: string; severity: string; description: string }[] = [];
const STUDY = {
  id: 's1',
  title: 'Demo: checkout flow',
  objective: 'Find the confusing step.',
  rewardCredits: 50,
  slotsRemaining: 3,
  buildUnderTest: null,
  tasks: [
    { id: 't1', instruction: 'Add any item to the cart and open checkout', successCriteria: 'Checkout is open' },
    { id: 't2', instruction: 'Reach the receipt screen and note anything confusing', successCriteria: null },
  ],
  consentText: 'I agree.',
  consentVersion: 1,
  myParticipationId: 'p1',
};
jest.mock('../src/lib/queries', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const loaded = <T,>(data: T) => ({ isLoading: false, error: null, data, refetch: jest.fn() });
  return {
    useParticipation: (id: string) => useQuery({ queryKey: ['participation', id], queryFn: () => mockParticipation }),
    useTesterStudy: () => loaded(STUDY),
    useEvidence: () => loaded({ items: mockEvidence }),
    useFindings: () => loaded({ items: mockFindings }),
    useMyDisputes: () => loaded({ items: mockDisputes }),
  };
});

const base = (status: Participation['status'], extra: Partial<Participation> = {}): Participation => ({
  id: 'p1',
  studyId: 's1',
  testerId: 'u1',
  testerDisplayName: null,
  status,
  consentVersion: 1,
  consentedAt: '2026-10-03T14:03:00.000Z',
  startedAt: null,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  rewardCredits: 50,
  taskNotes: [],
  ...extra,
});

let reduced = false;
beforeEach(() => {
  jest.useFakeTimers();
  reduced = false;
  mockCapability = { available: true };
  mockRecorder.live = false;
  mockRecorder.startAsync.mockReset().mockImplementation(() => {
    mockRecorder.live = true;
    return Promise.resolve();
  });
  mockRecorder.stopAsync.mockReset().mockImplementation(() => {
    mockRecorder.live = false;
    return Promise.resolve({ uri: 'file:///clip.mp4', durationMs: 5000, sizeBytes: 2 * 1024 * 1024, mimeType: 'video/mp4' });
  });
  mockApi.mockReset();
  mockUpload.mockReset();
  mockEvidence = [];
  mockDisputes = [];
  mockFindings = [];
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduced));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const flush = () =>
  act(async () => {
    jest.advanceTimersByTime(1);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 3; i++) await Promise.resolve();
  });

async function renderScreen(p: Participation, scheme: ThemePreference = 'dark') {
  mockParticipation = p;
  let setPreference: ((s: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  client.setQueryData(['participation', 'p1'], p);
  const result = await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">
          <Scheme>
            <ParticipationScreen />
          </Scheme>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await act(async () => setPreference?.(scheme));
  await flush();
  return { ...result, client };
}

async function press(testID: string) {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(testID));
  });
  await flush();
}

describe('Start session after U2', () => {
  /** The S4 band's clips drawn inside the Start session button (the shared Button's own sweep). */
  type Host = { props: { style?: unknown }; children: (Host | string)[] };
  const clips = (n: Host): number =>
    ((StyleSheet.flatten(n.props.style as never) as { overflow?: string } | undefined)?.overflow === 'hidden' ? 1 : 0) +
    n.children.reduce((sum, c) => sum + (typeof c === 'string' ? 0 : clips(c)), 0);
  const sweepsIn = (testID: string) => clips(screen.getByTestId(testID) as unknown as Host);

  it('sweeps once inside the Button (sweepSignal), 600ms after U2 starts', async () => {
    stampArrival('push', { handoff: 'u2' });
    await renderScreen(base('consented'));
    const before = sweepsIn('session-start');
    await advance(DUR.enter + 590);
    expect(sweepsIn('session-start')).toBe(before);
    await advance(20);
    expect(sweepsIn('session-start')).toBe(before + 1);
  });

  it('reduced motion: no sweep', async () => {
    reduced = true;
    stampArrival('push', { handoff: 'u2' });
    await renderScreen(base('consented'));
    const before = sweepsIn('session-start');
    await advance(DUR.enter + 2000);
    expect(sweepsIn('session-start')).toBe(before);
  });
});

describe('Your session', () => {
  it('consented: the header, the consent card, the task card, Withdraw, and Start in the dock', async () => {
    await renderScreen(base('consented'));
    expect(screen.getByTestId('participation-screen')).toBeTruthy();
    expect(screen.getByTestId('session-status')).toHaveTextContent(/CONSENTED/);
    expect(screen.getByText('Demo: checkout flow')).toBeTruthy();
    expect(screen.getByText(/Reward if approved · Not guaranteed/)).toHaveTextContent('50 test credits · Reward if approved · Not guaranteed');
    expect(screen.getByText(/You consented on/)).toHaveTextContent(/Start when you’re ready to do the tasks\./);
    expect(screen.getByTestId('task-0')).toHaveTextContent(/TASK 1/);
    expect(screen.getByText('Done when: Checkout is open')).toBeTruthy();
    expect(screen.getByTestId('session-withdraw')).toBeTruthy();
    expect(screen.getByTestId('session-start')).toBeTruthy();
    // Nothing of In progress yet.
    expect(screen.queryByTestId('recorder-card')).toBeNull();
    expect(screen.queryByTestId('task-note-0')).toBeNull();
    expect(screen.queryByTestId('session-submit')).toBeNull();
  });

  it('Start session opens the session in place: notes, the recorder, Attach and Finish', async () => {
    mockApi.mockResolvedValue(base('in_progress'));
    await renderScreen(base('consented'));
    await press('session-start');
    expect(mockApi).toHaveBeenCalledWith('startParticipation', { params: { id: 'p1' } });
    expect(screen.getByTestId('session-status')).toHaveTextContent(/IN PROGRESS/);
    expect(screen.queryByTestId('session-start')).toBeNull();
    expect(screen.getByTestId('task-note-0')).toBeTruthy();
    expect(screen.getByTestId('task-note-save-0')).toHaveTextContent('Saved');
    expect(screen.getByTestId('recorder-card')).toBeTruthy();
    expect(screen.getByTestId('record-start')).toBeTruthy();
    expect(screen.getByTestId('attach-evidence')).toBeTruthy();
    expect(screen.getByText('No evidence uploaded yet.')).toBeTruthy();
    expect(screen.getByTestId('session-submit')).not.toBeDisabled();
  });

  it('a failed start shows "Action failed" and keeps the dock', async () => {
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockRejectedValue(new ApiError('CONFLICT', 'This study is not accepting work right now.'));
    await renderScreen(base('consented'));
    await press('session-start');
    expect(screen.getByTestId('session-error')).toHaveTextContent(/Action failed/);
    expect(screen.getByTestId('session-error')).toHaveTextContent(/This study is not accepting work right now\./);
    expect(screen.getByTestId('session-start')).toBeTruthy();
  });

  it('notes: Save note while dirty, Saved once the server has it', async () => {
    const saved = base('in_progress', { taskNotes: [{ taskId: 't1', note: 'Below the fold.' } as Participation['taskNotes'][number]] });
    mockApi.mockResolvedValue(saved);
    await renderScreen(base('in_progress'));
    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('task-note-0'), 'Below the fold.');
    });
    expect(screen.getByTestId('task-note-save-0')).toHaveTextContent('Save note');
    await press('task-note-save-0');
    expect(mockApi).toHaveBeenCalledWith('putTaskNote', { params: { id: 'p1', taskId: 't1' }, body: { note: 'Below the fold.' } });
    expect(screen.getByTestId('task-note-save-0')).toHaveTextContent('Saved');
  });

  it('recording: Stop turns the clip into a local row to review; Submit waits for it; Keep, then Upload', async () => {
    mockUpload.mockResolvedValue({ id: 'e1' });
    await renderScreen(base('in_progress'));
    await press('record-start');
    expect(mockRecorder.startAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('record-stop')).toBeTruthy();
    expect(screen.getByTestId('pending-evidence')).toHaveTextContent(/upload or remove 1 item before submitting/);
    expect(screen.getByTestId('session-submit')).toBeDisabled();
    await press('record-stop');
    expect(screen.getByTestId('segment-recorded')).toHaveTextContent(/video\/mp4/);
    expect(screen.getByText('Review before upload')).toBeTruthy();
    expect(screen.queryByTestId('upload-kept')).toBeNull();
    await press('segment-keep');
    expect(screen.getByTestId('segment-kept')).toBeTruthy();
    expect(screen.getByTestId('upload-kept')).toHaveTextContent('Upload 1 kept item');
    await press('upload-kept');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0]![0]).toBe('p1');
  });

  it('Remove deletes the clip before upload: the row leaves and nothing is pending', async () => {
    await renderScreen(base('in_progress'));
    await press('record-start');
    await press('record-stop');
    await press('segment-remove');
    // The row fades out in place (240ms) before it leaves the list.
    await advance(300);
    expect(screen.queryByTestId('segment-recorded')).toBeNull();
    expect(screen.queryByTestId('pending-evidence')).toBeNull();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-submit')).not.toBeDisabled();
  });

  it('uploaded evidence is one line per item, kind first', async () => {
    mockEvidence = [{ id: 'e1', kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes: 12 * 1024, createdAt: '2026-10-03T14:16:00.000Z' }];
    await renderScreen(base('in_progress'));
    expect(screen.getByTestId('uploaded-evidence')).toHaveTextContent(/Uploaded \(1\)/);
    expect(screen.getByText(/^Recording · video\/mp4 · 12 KB · /)).toBeTruthy();
  });

  it('recording unavailable: the warning, and Attach still works', async () => {
    mockCapability = { available: false, reason: 'Screen recording needs Android 10 or newer.' };
    await renderScreen(base('in_progress'));
    expect(screen.getByTestId('recording-unavailable')).toHaveTextContent(/Screen recording needs Android 10 or newer\./);
    expect(screen.queryByTestId('recorder-card')).toBeNull();
    expect(screen.getByTestId('attach-evidence')).toBeTruthy();
  });

  it('U4: Submit holds In progress for the Lock and the Commit pass, then Awaiting review', async () => {
    mockApi.mockResolvedValue(base('submitted', { taskNotes: [{ taskId: 't1', note: 'Below the fold.' } as Participation['taskNotes'][number]] }));
    const { client } = await renderScreen(base('in_progress'));
    await press('session-submit');
    expect(screen.getByText('Submit for review?')).toBeTruthy();
    await press('confirm-ok');
    expect(mockApi).toHaveBeenCalledWith('submitParticipation', { params: { id: 'p1' } });
    // The cache has the server's answer at once; the view holds for U4.
    expect(client.getQueryData<Participation>(['participation', 'p1'])?.status).toBe('submitted');
    expect(screen.getByTestId('session-status')).toHaveTextContent(/IN PROGRESS/);
    expect(screen.getByTestId('session-submit')).toBeTruthy();
    // Held, not live: Submit and Withdraw are announced busy and take no press, and the notes take no text.
    expect(screen.getByTestId('session-submit').props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(screen.getByTestId('session-withdraw').props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(screen.getByTestId('task-note-0').props.editable).toBe(false);
    await advance(1000);
    expect(screen.queryByTestId('awaiting-review')).toBeNull();
    await advance(700);
    expect(screen.getByTestId('session-status')).toHaveTextContent(/AWAITING REVIEW/);
    expect(screen.getByTestId('awaiting-review')).toHaveTextContent(/The builder will approve or reject your work\./);
    expect(screen.queryByTestId('session-submit')).toBeNull();
    expect(screen.queryByTestId('recorder-card')).toBeNull();
    // The recap keeps the tasks and the tester's note.
    expect(screen.getByText('Your notes: Below the fold.')).toBeTruthy();
  });

  it('U4 under reduced motion: no pass to wait for, Awaiting review after one tick', async () => {
    reduced = true;
    mockApi.mockResolvedValue(base('submitted'));
    await renderScreen(base('in_progress'));
    await press('session-submit');
    await press('confirm-ok');
    await advance(130);
    expect(screen.getByTestId('awaiting-review')).toBeTruthy();
  });

  it('a failed submit keeps the sheet open with the server error', async () => {
    const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
    mockApi.mockRejectedValue(new ApiError('CONFLICT', 'Upload or remove pending evidence first.'));
    await renderScreen(base('in_progress'));
    await press('session-submit');
    await press('confirm-ok');
    expect(screen.getByTestId('confirm-sheet')).toHaveTextContent(/Action failed/);
    expect(screen.getByTestId('confirm-sheet')).toHaveTextContent(/Upload or remove pending evidence first\./);
    expect(screen.getByTestId('session-status')).toHaveTextContent(/IN PROGRESS/);
  });

  it('withdraw asks first, then closes the session', async () => {
    mockApi.mockResolvedValue(base('withdrawn'));
    await renderScreen(base('consented'));
    await press('session-withdraw');
    expect(screen.getByText('Withdraw from this study?')).toBeTruthy();
    await press('confirm-ok');
    expect(mockApi).toHaveBeenCalledWith('withdrawParticipation', { params: { id: 'p1' }, body: {} });
    expect(screen.getByText('You withdrew')).toBeTruthy();
    expect(screen.queryByTestId('session-start')).toBeNull();
  });

  it('approved: the lit Approved notice, the devnet transfer, the findings and the recap', async () => {
    mockFindings = [{ id: 'f1', title: 'OTP destination unclear', severity: 'major', description: 'Tester could not tell where the one-time code was sent.' }];
    await renderScreen(base('approved', { decidedAt: '2026-10-03T16:40:00.000Z' }));
    expect(screen.getByTestId('approved-notice')).toHaveTextContent(/50 test credits added to your balance\. Test credits have no cash value\./);
    expect(screen.getByTestId('transfer-card')).toBeTruthy();
    expect(screen.getByText('Findings from the builder')).toBeTruthy();
    expect(screen.getByText('OTP destination unclear')).toBeTruthy();
    expect(screen.getByTestId('task-1')).toHaveTextContent(/Reach the receipt screen/);
  });

  it('rejected: the reason, the dispute window and the dispute sheet', async () => {
    const decidedAt = new Date(Date.now() - 60_000).toISOString();
    mockApi.mockResolvedValue({ id: 'd1' });
    await renderScreen(base('rejected', { decidedAt, decisionReason: 'The receipt screen was never reached.' }));
    expect(screen.getByTestId('rejected-notice')).toHaveTextContent(/Reason: The receipt screen was never reached\./);
    expect(screen.getByText(/You can dispute until/)).toBeTruthy();
    await press('dispute-open');
    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('dispute-reason'), 'My note explains the checkout step.');
    });
    await press('confirm-ok');
    expect(mockApi).toHaveBeenCalledWith('openDispute', { body: { participationId: 'p1', reason: 'My note explains the checkout step.' } });
  });

  it('disputed: the dispute card with its status', async () => {
    mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'open', outcome: null, resolutionNote: null }];
    await renderScreen(base('disputed', { decidedAt: '2026-10-03T16:40:00.000Z' }));
    expect(screen.getByTestId('dispute-card')).toHaveTextContent(/OPEN/);
    expect(screen.getByTestId('dispute-card')).toHaveTextContent(/An admin will review it\./);
  });

  it('resolved: the overturned dispute card (U6) and the transfer', async () => {
    mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'resolved', outcome: 'overturned', resolutionNote: 'The note documents the checkout step.' }];
    await renderScreen(base('resolved', { decidedAt: '2026-10-03T16:40:00.000Z' }));
    expect(screen.getByTestId('dispute-card')).toHaveTextContent(/Overturned: the reward was credited\. The note documents the checkout step\./);
    expect(screen.getByTestId('transfer-card')).toBeTruthy();
  });

  it('withdrawn: the closed panel, then the read-only recap of the tasks and saved notes (as on main)', async () => {
    await renderScreen(base('withdrawn', { taskNotes: [{ taskId: 't1', note: 'Below the fold.' } as Participation['taskNotes'][number]] }));
    expect(screen.getByText('You withdrew')).toBeTruthy();
    expect(screen.getByText('This session is closed. Nothing more is needed from you.')).toBeTruthy();
    expect(screen.queryByTestId('session-withdraw')).toBeNull();
    expect(screen.getByTestId('task-0')).toBeTruthy();
    expect(screen.getByText('Your notes: Below the fold.')).toBeTruthy();
    expect(screen.queryByTestId('task-note-0')).toBeNull();
  });

  it.each<ThemePreference>(['light', 'dark'])('renders every live control in %s', async (scheme) => {
    await renderScreen(base('in_progress'), scheme);
    await press('record-start');
    expect(screen.getByTestId('record-stop')).toBeTruthy();
    await press('record-stop');
    expect(screen.getByTestId('segment-recorded')).toBeTruthy();
  });
});
