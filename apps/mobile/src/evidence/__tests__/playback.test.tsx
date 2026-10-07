import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Evidence } from '@pocket-qa/contracts';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { EvidenceStrip } from '../../screens/review/EvidenceStrip';
import { EvidenceItem } from '../EvidenceItem';
import { playbackUri } from '../playback';

// Plan §6 playback: private R2 grants a presigned URL on the storage endpoint, which the player
// opens directly; local storage grants a token for the API's /media route (unchanged).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockApi = jest.fn();
jest.mock('../../api/client', () => {
  class ApiError extends Error {
    code = 'X';
  }
  return { ApiError, api: (...args: unknown[]) => mockApi(...args), mediaUrl: (token: string) => `http://api.test/media/${token}` };
});
// The players record the source and props they were given.
const mockSources: string[] = [];
const mockProps: Record<string, unknown>[] = [];
jest.mock('expo-video', () => ({
  useVideoPlayer: (uri: string) => {
    mockSources.push(uri);
    return {};
  },
  VideoView: (props: Record<string, unknown>) => {
    mockProps.push(props);
    return null;
  },
}));
jest.mock('expo-image', () => ({
  Image: (props: { source: { uri: string } }) => {
    mockSources.push(props.source.uri);
    mockProps.push(props);
    return null;
  },
}));

/**
 * The presigned GET needs no bucket CORS rule only while the web players load it as a plain
 * <video src> / <img src>: expo-video's VideoView.web.js sets crossOrigin only from the prop
 * (l.219) and routes audio through createMediaElementSource only with useAudioNodePlayback
 * (l.39-41, 156: silent for a cross-origin video without CORS); expo-image's web hooks.ts fetches
 * the URL (CORS) only when the source has headers (l.43-48). None may be passed.
 */
function expectPlainMediaLoad() {
  expect(mockProps.length).toBeGreaterThan(0);
  for (const p of mockProps) {
    expect(p.crossOrigin).toBeUndefined();
    expect(p.useAudioNodePlayback).toBeUndefined();
    expect((p.source as { headers?: unknown } | undefined)?.headers).toBeUndefined();
  }
}

const PRESIGNED = 'https://acct.r2.cloudflarestorage.com/pocketqa-evidence/evidence/ev1?X-Amz-Expires=300&X-Amz-Signature=abc';
const TOKEN = 'a'.repeat(43);
const EV: Evidence = {
  id: 'ev1',
  participationId: 'p1',
  kind: 'screen_recording',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
  durationMs: 1000,
  taskId: null,
  capturedOn: 'android',
  createdAt: '2026-10-06T10:00:00.000Z',
};

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">{ui}</ThemeProvider>
    </SafeAreaProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi.mockReset();
  mockSources.length = 0;
  mockProps.length = 0;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(true));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => jest.restoreAllMocks());

describe('playbackUri', () => {
  it('prefers the presigned URL; otherwise builds the /media URL from the token', () => {
    expect(playbackUri({ url: PRESIGNED, expiresAt: '2026-10-06T10:05:00.000Z' })).toBe(PRESIGNED);
    expect(playbackUri({ token: TOKEN, expiresAt: '2026-10-06T10:05:00.000Z' })).toBe(`http://api.test/media/${TOKEN}`);
  });
});

const SHOT: Evidence = { ...EV, id: 'ev2', kind: 'screenshot', mimeType: 'image/png' };

it('a screenshot loads as a plain image too (no headers, so no fetch)', async () => {
  mockApi.mockResolvedValue({ url: PRESIGNED, expiresAt: '2026-10-06T10:05:00.000Z' });
  await render(wrap(<EvidenceItem e={SHOT} />));
  await act(async () => fireEvent.press(screen.getByTestId('evidence-view')));
  expect(mockSources).toContain(PRESIGNED);
  expectPlainMediaLoad();
});

describe.each([
  ['private R2', { url: PRESIGNED }, PRESIGNED],
  ['local storage', { token: TOKEN }, `http://api.test/media/${TOKEN}`],
])('%s', (_name, grant, expected) => {
  it('EvidenceItem plays from the granted source', async () => {
    mockApi.mockResolvedValue({ ...grant, expiresAt: '2026-10-06T10:05:00.000Z' });
    await render(wrap(<EvidenceItem e={EV} />));
    await act(async () => fireEvent.press(screen.getByTestId('evidence-view')));
    expect(mockApi).toHaveBeenCalledWith('playbackToken', { params: { id: 'ev1' } });
    expect(mockSources).toContain(expected);
    expectPlainMediaLoad();
  });

  it('EvidenceStrip plays from the granted source', async () => {
    mockApi.mockResolvedValue({ ...grant, expiresAt: '2026-10-06T10:05:00.000Z' });
    await render(wrap(<EvidenceStrip items={[EV]} />));
    await fireEvent(screen.getByTestId('evidence-strip'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 400 } } });
    await act(async () => fireEvent.press(screen.getByTestId('evidence-view')));
    expect(mockApi).toHaveBeenCalledWith('playbackToken', { params: { id: 'ev1' } });
    expect(mockSources).toContain(expected);
    expectPlainMediaLoad();
  });
});
