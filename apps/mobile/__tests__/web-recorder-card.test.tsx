import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RecorderState } from '../src/evidence/webScreenRecorder';
import { ThemeProvider } from '../src/theme/ThemeProvider';

// The web recorder card (docs/plans/web-screen-audio-recording.md; pqa-qa T1, T11, T12, T14), with
// the controller replaced by a stub whose state the test drives.
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockDownload = jest.fn();
jest.mock('../src/evidence/localDownload', () => ({ downloadLocal: (...a: unknown[]) => mockDownload(...a) }));
const mockCtl = { start: jest.fn(), stop: jest.fn(), discard: jest.fn(), dispose: jest.fn(), onChange: (_: RecorderState) => {} };
jest.mock('../src/evidence/webScreenRecorder', () => {
  const actual = jest.requireActual('../src/evidence/webScreenRecorder');
  return {
    ...actual,
    browserRecorderEnv: () => ({}),
    WebScreenRecorder: class {
      state = { kind: 'ready', notice: null };
      constructor(_env: unknown, opts: { onChange: (s: RecorderState) => void }) {
        mockCtl.onChange = opts.onChange;
      }
      start = () => mockCtl.start();
      stop = () => mockCtl.stop();
      discard = () => mockCtl.discard();
      dispose = () => mockCtl.dispose();
    },
  };
});
import { WebRecorderCard } from '../src/evidence/WebRecorderCard';

const METRICS = { frame: { x: 0, y: 0, width: 1280, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const tree = (node: ReactNode) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">{node}</ThemeProvider>
  </SafeAreaProvider>
);
const drive = async (s: RecorderState) => act(async () => mockCtl.onChange(s));

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(mockCtl).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as jest.Mock).mockClear());
  mockDownload.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const available = { available: true } as const;

describe('WebRecorderCard', () => {
  it('unsupported browser: the honest reason under recording-unavailable, and no start button (T12)', async () => {
    await render(tree(<WebRecorderCard locked={false} capability={{ available: false, reason: 'Screen recording in the browser works on a computer only.' }} />));
    expect(screen.getByTestId('recording-unavailable')).toHaveTextContent(/computer only/);
    expect(screen.queryByTestId('web-rec-start')).toBeNull();
  });

  it('privacy copy before anything is shared, and Start stays off until this session’s consent is given (T1, T11)', async () => {
    await render(tree(<WebRecorderCard locked={false} capability={available} />));
    const copy = screen.getByTestId('web-rec-privacy');
    expect(copy).toHaveTextContent(/Everything visible in what you share is recorded/);
    expect(copy).toHaveTextContent(/passwords/);
    expect(copy).toHaveTextContent(/Choose a single tab or window/);
    expect(copy).toHaveTextContent(/microphone.*narration/);
    expect(copy).toHaveTextContent(/stays on this device.*not uploaded/);
    await fireEvent.press(screen.getByTestId('web-rec-start'));
    expect(mockCtl.start).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('web-rec-consent'));
    await fireEvent.press(screen.getByTestId('web-rec-start'));
    expect(mockCtl.start).toHaveBeenCalledTimes(1);
  });

  it('a locked session can’t start', async () => {
    await render(tree(<WebRecorderCard locked capability={available} />));
    await fireEvent.press(screen.getByTestId('web-rec-consent'));
    await fireEvent.press(screen.getByTestId('web-rec-start'));
    expect(mockCtl.start).not.toHaveBeenCalled();
  });

  it('while asking: says which browser prompt is open', async () => {
    await render(tree(<WebRecorderCard locked={false} capability={available} />));
    await drive({ kind: 'requesting-screen' });
    expect(screen.getByTestId('web-rec-status')).toHaveTextContent(/Choose a tab, window or screen/);
    await drive({ kind: 'requesting-mic' });
    expect(screen.getByTestId('web-rec-status')).toHaveTextContent(/Allow the microphone/);
  });

  it('recording: a live status with the timer and the cap, and Stop (T7)', async () => {
    await render(tree(<WebRecorderCard locked={false} capability={available} />));
    await drive({ kind: 'recording', elapsedMs: 83_000, bytes: 1000 });
    expect(screen.getByTestId('web-rec-status')).toHaveTextContent('Recording · 01:23 / 15:00');
    await fireEvent.press(screen.getByTestId('web-rec-stop'));
    expect(mockCtl.stop).toHaveBeenCalled();
  });

  it('review: replay, download under the safe name, discard; and why it stopped (T8, T14)', async () => {
    await render(tree(<WebRecorderCard locked={false} capability={available} />));
    const blob = new Blob(['x']);
    await drive({ kind: 'review', blob, url: 'blob:u1', mimeType: 'video/webm', durationMs: 65_000, size: 2_400_000, endedBy: 'screen-ended', fileName: 'pocketqa-recording-20261005-140309.webm' });
    expect(screen.getByTestId('web-rec-review')).toHaveTextContent(/01:05/);
    expect(screen.getByTestId('web-rec-review')).toHaveTextContent(/stays on this device/);
    expect(screen.getByTestId('web-rec-ended')).toHaveTextContent(/stopped sharing from the browser/);
    expect(screen.getByTestId('web-rec-player').props.src).toBe('blob:u1');
    await fireEvent.press(screen.getByTestId('web-rec-download'));
    expect(mockDownload).toHaveBeenCalledWith('blob:u1', 'pocketqa-recording-20261005-140309.webm');
    await fireEvent.press(screen.getByTestId('web-rec-discard'));
    expect(mockCtl.discard).toHaveBeenCalled();
  });

  it.each([
    ['max-duration', /15-minute limit/],
    ['max-size', /size limit/],
    ['mic-ended', /microphone stopped/],
    ['recorder-error', /browser stopped the recording/],
  ] as const)('review after %s explains it', async (endedBy, msg) => {
    await render(tree(<WebRecorderCard locked={false} capability={available} />));
    await drive({ kind: 'review', blob: new Blob(['x']), url: 'blob:u1', mimeType: 'video/webm', durationMs: 1000, size: 10, endedBy, fileName: 'f.webm' });
    expect(screen.getByTestId('web-rec-ended')).toHaveTextContent(msg);
  });

  it('errors and a cancelled chooser are shown, and Start stays available to retry', async () => {
    await render(tree(<WebRecorderCard locked={false} capability={available} />));
    await fireEvent.press(screen.getByTestId('web-rec-consent'));
    await drive({ kind: 'error', message: 'Microphone access was blocked. Narration is required, so the screen share was stopped and nothing was recorded.' });
    expect(screen.getByTestId('web-rec-error')).toHaveTextContent(/Microphone access was blocked/);
    await fireEvent.press(screen.getByTestId('web-rec-start'));
    expect(mockCtl.start).toHaveBeenCalledTimes(1);
    await drive({ kind: 'ready', notice: 'Screen sharing was cancelled or blocked. Nothing was recorded.' });
    expect(screen.getByTestId('web-rec-error')).toHaveTextContent(/cancelled or blocked/);
  });

  it('unmounting disposes the recorder (route change, sign-out) (T7)', async () => {
    const { unmount } = await render(tree(<WebRecorderCard locked={false} capability={available} />));
    await unmount();
    expect(mockCtl.dispose).toHaveBeenCalled();
  });
});
