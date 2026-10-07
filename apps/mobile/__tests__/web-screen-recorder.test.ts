import {
  chooseMimeType,
  disposeAllWebRecorders,
  DISPLAY_OPTIONS,
  recordingFileName,
  webRecordingCapability,
  WebScreenRecorder,
  type RecorderEnv,
  type RecorderState,
} from '../src/evidence/webScreenRecorder';

// The desktop web recorder's controller (docs/plans/web-screen-audio-recording.md), against fakes
// of the browser media APIs. pqa-qa threat review r1: T1–T9, T12, T14.

class FakeTrack {
  stopped = 0;
  private listeners: (() => void)[] = [];
  constructor(
    readonly kind: 'video' | 'audio',
    readonly label: string = kind,
  ) {}
  stop() {
    this.stopped++;
  }
  addEventListener(type: string, fn: () => void) {
    if (type === 'ended') this.listeners.push(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  get listenerCount() {
    return this.listeners.length;
  }
  /** What the browser does when the user presses its own "Stop sharing" (not fired by stop()). */
  end() {
    this.listeners.forEach((l) => l());
  }
}
class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const domError = (name: string) => Object.assign(new Error(name), { name });

class FakeRecorder {
  static supported = new Set(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
  static last: FakeRecorder | null = null;
  static isTypeSupported(t: string) {
    return FakeRecorder.supported.has(t);
  }
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: { error: Error }) => void) | null = null;
  timeslice: number | undefined;
  readonly mimeType: string;
  constructor(
    readonly stream: FakeStream,
    opts: { mimeType?: string } = {},
  ) {
    this.mimeType = opts.mimeType ?? '';
    FakeRecorder.last = this;
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['tail']) });
    this.onstop?.();
  }
  /** A chunk as the browser would deliver it every timeslice. */
  chunk(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  /** A fatal encoder error: error, final data, then stop (W3C MediaStream Recording). */
  fail() {
    this.state = 'inactive';
    this.onerror?.({ error: domError('UnknownError') });
    this.ondataavailable?.({ data: new Blob(['x']) });
    this.onstop?.();
  }
}

let clock: number;
let intervals: Map<number, () => void>;
let urls: { created: string[]; revoked: string[] };
let display: ReturnType<typeof deferred<FakeStream>>;
let mic: ReturnType<typeof deferred<FakeStream>>;
let calls: string[];
let env: RecorderEnv;
let screenTrack: FakeTrack;
let micTrack: FakeTrack;

beforeEach(() => {
  clock = 1_000_000;
  intervals = new Map();
  urls = { created: [], revoked: [] };
  display = deferred();
  mic = deferred();
  calls = [];
  screenTrack = new FakeTrack('video', 'screen');
  micTrack = new FakeTrack('audio', 'mic');
  FakeRecorder.last = null;
  FakeRecorder.supported = new Set(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
  let n = 0;
  env = {
    mediaDevices: {
      getDisplayMedia: (opts: unknown) => (calls.push(`display:${JSON.stringify(opts)}`), display.promise),
      getUserMedia: (opts: unknown) => (calls.push(`mic:${JSON.stringify(opts)}`), mic.promise),
    },
    MediaRecorder: FakeRecorder,
    MediaStream: FakeStream,
    createObjectURL: () => {
      const u = `blob:u${++n}`;
      urls.created.push(u);
      return u;
    },
    revokeObjectURL: (u: string) => void urls.revoked.push(u),
    now: () => clock,
    setInterval: (fn: () => void) => {
      const id = intervals.size + 1;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id: unknown) => void intervals.delete(id as number),
  } as unknown as RecorderEnv;
});
afterEach(() => disposeAllWebRecorders());

const flush = () => new Promise((r) => setTimeout(r, 0));
const tick = (ms: number) => {
  clock += ms;
  intervals.forEach((fn) => fn());
};
function make(opts: Partial<{ maxDurationMs: number; maxBytes: number }> = {}) {
  const states: RecorderState[] = [];
  const r = new WebScreenRecorder(env, { onChange: (s) => states.push(s), ...opts });
  return { r, states };
}
async function recording(opts?: Partial<{ maxDurationMs: number; maxBytes: number }>) {
  const m = make(opts);
  m.r.start();
  display.resolve(new FakeStream([screenTrack]));
  await flush();
  mic.resolve(new FakeStream([micTrack]));
  await flush();
  return m;
}

describe('start: the screen chooser first, synchronously; then the microphone (T1, T2)', () => {
  it('calls getDisplayMedia inside start() itself, before any await, and the mic only after a screen is chosen', async () => {
    const { r } = make();
    r.start();
    expect(calls).toEqual([`display:${JSON.stringify(DISPLAY_OPTIONS)}`]);
    expect(r.state.kind).toBe('requesting-screen');
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    expect(calls[1]).toBe('mic:{"audio":{"echoCancellation":true,"noiseSuppression":true},"video":false}');
    expect(r.state.kind).toBe('requesting-mic');
  });
  it('asks for a tab first, no system audio, and excludes the Pocket QA tab itself (T5, T13)', () => {
    expect(DISPLAY_OPTIONS).toEqual({ video: { displaySurface: 'browser' }, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'exclude', monitorTypeSurfaces: 'include' });
  });
  it('records ONE stream: the screen video plus a single mic audio track, built before start (T5)', async () => {
    const { r } = await recording();
    const rec = FakeRecorder.last!;
    expect(rec.stream.tracks).toEqual([screenTrack, micTrack]);
    expect(rec.state).toBe('recording');
    expect(rec.timeslice).toBe(1000);
    expect(rec.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(r.state).toMatchObject({ kind: 'recording', elapsedMs: 0, bytes: 0 });
  });
  it('a second start while busy is ignored', async () => {
    const { r } = make();
    r.start();
    r.start();
    expect(calls).toHaveLength(1);
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    mic.resolve(new FakeStream([micTrack]));
    await flush();
    r.start();
    expect(calls).toHaveLength(2);
  });
});

describe('cancel and denial', () => {
  it('a cancelled chooser (NotAllowedError) returns to ready, says nothing was recorded, and never asks for the mic', async () => {
    const { r } = make();
    r.start();
    display.reject(domError('NotAllowedError'));
    await flush();
    expect(r.state).toEqual({ kind: 'ready', notice: 'Screen sharing was cancelled or blocked. Nothing was recorded.' });
    expect(calls).toHaveLength(1);
  });
  it.each([
    ['NotFoundError', /No screen, window or tab/],
    ['InvalidStateError', /direct click/],
    ['NotReadableError', /couldn’t read the chosen screen/],
    ['AbortError', /Screen sharing failed/],
  ])('%s from the chooser → a retryable error', async (name, msg) => {
    const { r } = make();
    r.start();
    display.reject(domError(name));
    await flush();
    expect(r.state).toMatchObject({ kind: 'error', message: expect.stringMatching(msg) });
  });
  it.each([
    ['NotAllowedError', /Microphone access was blocked/],
    ['NotFoundError', /No microphone was found/],
    ['NotReadableError', /microphone is in use or unavailable/],
  ])('mic %s: the screen share is stopped at once and nothing is recorded without narration (T3)', async (name, msg) => {
    const { r } = make();
    r.start();
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    mic.reject(domError(name));
    await flush();
    expect(screenTrack.stopped).toBe(1);
    expect(FakeRecorder.last).toBeNull();
    expect(r.state).toMatchObject({ kind: 'error', message: expect.stringMatching(msg) });
    expect((r.state as { message: string }).message).toMatch(/screen share was stopped and nothing was recorded/);
  });
  it('a screen stream without a video track is refused and released', async () => {
    const { r } = make();
    const odd = new FakeTrack('audio');
    r.start();
    display.resolve(new FakeStream([odd]));
    await flush();
    expect(odd.stopped).toBe(1);
    expect(r.state.kind).toBe('error');
  });
});

describe('cancel while the browser is asking (pqa-qa r1 P2-1: a prompt may never be answered)', () => {
  it('Cancel while the share dialog is open returns to ready; a screen chosen later is released at once', async () => {
    const { r } = make();
    r.start();
    r.cancel();
    expect(r.state).toEqual({ kind: 'ready', notice: 'Cancelled. Nothing was recorded.' });
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    expect(screenTrack.stopped).toBe(1);
    expect(calls).toHaveLength(1);
  });
  it('Cancel while the microphone prompt is unanswered releases the screen at once; a late mic is released too', async () => {
    const { r } = make();
    r.start();
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    expect(r.state.kind).toBe('requesting-mic');
    r.cancel();
    expect(screenTrack.stopped).toBe(1);
    expect(r.state).toEqual({ kind: 'ready', notice: 'Cancelled. Nothing was recorded.' });
    mic.resolve(new FakeStream([micTrack]));
    await flush();
    expect(micTrack.stopped).toBe(1);
    expect(FakeRecorder.last).toBeNull();
    // A new attempt works normally afterwards.
    expect(() => r.start()).not.toThrow();
  });
  it('the browser’s Stop sharing while the mic prompt is open ends the attempt (the listener exists before the mic answers)', async () => {
    const { r } = make();
    r.start();
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    screenTrack.end();
    expect(screenTrack.stopped).toBe(1);
    expect(r.state).toEqual({ kind: 'ready', notice: 'You stopped sharing before recording started. Nothing was recorded.' });
    mic.resolve(new FakeStream([micTrack]));
    await flush();
    expect(micTrack.stopped).toBe(1);
    expect(FakeRecorder.last).toBeNull();
  });
  it('cancel does nothing outside the asking states', async () => {
    const { r } = await recording();
    r.cancel();
    expect(r.state.kind).toBe('recording');
  });
  it('the early Stop-sharing listener is replaced once recording starts (no double handling)', async () => {
    const { r } = await recording();
    expect(screenTrack.listenerCount).toBe(1);
    screenTrack.end();
    await flush();
    expect(r.state).toMatchObject({ kind: 'review', endedBy: 'screen-ended' });
    expect(screenTrack.stopped).toBe(1);
  });
});

describe('late answers after the user moved on (T4)', () => {
  it('a screen chosen after dispose is stopped at once and changes nothing', async () => {
    const { r, states } = make();
    r.start();
    r.dispose();
    const seen = states.length;
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    expect(screenTrack.stopped).toBe(1);
    expect(calls).toHaveLength(1);
    expect(states).toHaveLength(seen);
    expect(r.state.kind).toBe('disposed');
  });
  it('a microphone granted after dispose stops both the mic and the screen tracks', async () => {
    const { r } = make();
    r.start();
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    r.dispose();
    expect(screenTrack.stopped).toBe(1);
    mic.resolve(new FakeStream([micTrack]));
    await flush();
    expect(micTrack.stopped).toBe(1);
    expect(FakeRecorder.last).toBeNull();
  });
  it('disposeAllWebRecorders (sign-out) disposes every live recorder', async () => {
    const { r } = await recording();
    disposeAllWebRecorders();
    expect(r.state.kind).toBe('disposed');
    expect(screenTrack.stopped).toBe(1);
    expect(micTrack.stopped).toBe(1);
  });
});

describe('every stop path keeps the draft and releases the devices once (T7, T8)', () => {
  it.each([
    ['Stop pressed', 'user', (r: WebScreenRecorder) => r.stop()],
    ['the browser’s Stop sharing (screen track ended)', 'screen-ended', () => screenTrack.end()],
    ['the microphone track ended', 'mic-ended', () => micTrack.end()],
    ['a recorder error', 'recorder-error', () => FakeRecorder.last!.fail()],
  ] as const)('%s → review with the bytes, tracks stopped once', async (_, endedBy, act) => {
    const { r } = await recording();
    FakeRecorder.last!.chunk(10);
    tick(2500);
    act(r);
    await flush();
    expect(r.state).toMatchObject({ kind: 'review', endedBy, mimeType: 'video/webm;codecs=vp9,opus', durationMs: 2500, url: 'blob:u1' });
    const review = r.state as Extract<RecorderState, { kind: 'review' }>;
    expect(review.size).toBe(review.blob.size);
    expect(review.blob.type).toBe('video/webm;codecs=vp9,opus');
    expect(review.fileName).toMatch(/^pocketqa-recording-\d{8}-\d{6}\.webm$/);
    expect(screenTrack.stopped).toBe(1);
    expect(micTrack.stopped).toBe(1);
    // Further stops are no-ops.
    r.stop();
    screenTrack.end();
    expect(screenTrack.stopped).toBe(1);
    expect(urls.created).toEqual(['blob:u1']);
  });
  it('discard revokes the one URL and returns to ready; a new recording gets a new URL; dispose revokes it too', async () => {
    const { r } = await recording();
    r.stop();
    await flush();
    r.discard();
    expect(urls.revoked).toEqual(['blob:u1']);
    expect(r.state).toEqual({ kind: 'ready', notice: null });
    screenTrack = new FakeTrack('video');
    micTrack = new FakeTrack('audio');
    display = deferred();
    mic = deferred();
    r.start();
    display.resolve(new FakeStream([screenTrack]));
    await flush();
    mic.resolve(new FakeStream([micTrack]));
    await flush();
    r.stop();
    await flush();
    r.dispose();
    expect(urls.created).toEqual(['blob:u1', 'blob:u2']);
    expect(urls.revoked).toEqual(['blob:u1', 'blob:u2']);
  });
  it('a new start is refused while a draft is under review (no silent loss)', async () => {
    const { r } = await recording();
    r.stop();
    await flush();
    r.start();
    expect(calls).toHaveLength(2);
    expect(r.state.kind).toBe('review');
  });
  it('dispose while recording stops everything and keeps no bytes or URL', async () => {
    const { r } = await recording();
    FakeRecorder.last!.chunk(10);
    r.dispose();
    expect(screenTrack.stopped).toBe(1);
    expect(micTrack.stopped).toBe(1);
    expect(urls.created).toEqual([]);
    expect(r.state.kind).toBe('disposed');
  });
  it('a recording with no data at all ends in an honest error, not an empty file', async () => {
    const { r } = await recording();
    const rec = FakeRecorder.last!;
    rec.state = 'inactive';
    rec.onstop?.();
    await flush();
    expect(r.state).toMatchObject({ kind: 'error', message: expect.stringMatching(/no data/) });
    expect(urls.created).toEqual([]);
  });
});

describe('bounded memory and duration (T9)', () => {
  it('stops at the duration cap and keeps the draft', async () => {
    const { r } = await recording({ maxDurationMs: 5000 });
    tick(4000);
    expect(r.state).toMatchObject({ kind: 'recording', elapsedMs: 4000 });
    tick(1000);
    await flush();
    expect(r.state).toMatchObject({ kind: 'review', endedBy: 'max-duration' });
  });
  it('stops at the byte cap and keeps the draft', async () => {
    const { r } = await recording({ maxBytes: 100 });
    FakeRecorder.last!.chunk(60);
    expect(r.state).toMatchObject({ kind: 'recording', bytes: 60 });
    FakeRecorder.last!.chunk(60);
    await flush();
    expect(r.state).toMatchObject({ kind: 'review', endedBy: 'max-size' });
  });
});

describe('MIME and file name (T6, T14)', () => {
  it('chooses the first supported type in order; none → null', () => {
    const only = (s: string[]) => (t: string) => s.includes(t);
    expect(chooseMimeType(only(['video/webm', 'video/webm;codecs=vp8,opus']))).toBe('video/webm;codecs=vp8,opus');
    expect(chooseMimeType(only(['video/mp4']))).toBe('video/mp4');
    expect(chooseMimeType(only([]))).toBeNull();
  });
  it('the blob type and extension follow the negotiated MIME (mp4 when that is all there is)', async () => {
    FakeRecorder.supported = new Set(['video/mp4']);
    const { r } = await recording();
    r.stop();
    await flush();
    expect(r.state).toMatchObject({ kind: 'review', mimeType: 'video/mp4', fileName: expect.stringMatching(/\.mp4$/) });
  });
  it('the file name is fixed and safe: no user or study text', () => {
    expect(recordingFileName('video/webm;codecs=vp9,opus', new Date(2026, 9, 5, 14, 3, 9))).toBe('pocketqa-recording-20261005-140309.webm');
    expect(recordingFileName('video/mp4', new Date(2026, 0, 2, 3, 4, 5))).toBe('pocketqa-recording-20260102-030405.mp4');
  });
});

describe('capability: desktop browsers only, said honestly (T12)', () => {
  const desktopUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const g = (over: Record<string, unknown> = {}, nav: Record<string, unknown> = {}) => ({
    isSecureContext: true,
    MediaRecorder: FakeRecorder,
    navigator: { userAgent: desktopUA, maxTouchPoints: 0, mediaDevices: { getDisplayMedia: () => 0, getUserMedia: () => 0 }, ...nav },
    ...over,
  });
  it('mobile browsers get the real alternatives, and never a claim that a web app can record other apps', () => {
    const c = webRecordingCapability(g({}, { userAgent: 'Mozilla/5.0 (Linux; Android 14; Seeker) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36' }));
    const reason = (c as { reason: string }).reason;
    expect(reason).toMatch(/can’t record other apps/);
    expect(reason).toMatch(/Pocket QA Android app/);
    expect(reason).toMatch(/iPhone app/);
    expect(reason).toMatch(/built-in screen recorder.*attach/);
    expect(reason).not.toMatch(/install(ed)? (this|the) web app|home screen app records|PWA records/i);
  });
  it('desktop Chrome with everything → available', () => {
    expect(webRecordingCapability(g())).toEqual({ available: true });
  });
  it.each([
    ['an insecure page', g({ isSecureContext: false }), /secure \(HTTPS\) page/],
    ['no getDisplayMedia', g({}, { mediaDevices: { getUserMedia: () => 0 } }), /doesn’t support screen sharing/],
    ['no mediaDevices at all', g({}, { mediaDevices: undefined }), /doesn’t support screen sharing/],
    ['no MediaRecorder', g({ MediaRecorder: undefined }), /can’t record video/],
    ['no supported format', g({ MediaRecorder: { isTypeSupported: () => false } }), /can’t record video/],
    ['Chrome on Android (exposes the API but it always fails)', g({}, { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36' }), /computer/],
    ['userAgentData.mobile', g({}, { userAgentData: { mobile: true } }), /computer/],
    ['iPhone Safari', g({}, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }), /computer/],
    ['iPadOS with a desktop UA', g({}, { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' }), /computer/],
  ])('%s → unavailable with an honest reason', (_, globals, reason) => {
    const c = webRecordingCapability(globals);
    expect(c.available).toBe(false);
    expect((c as { reason: string }).reason).toMatch(reason);
  });
});
