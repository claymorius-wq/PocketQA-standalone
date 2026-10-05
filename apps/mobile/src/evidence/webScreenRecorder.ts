import type { Capability } from '../lib/capability';

/**
 * Desktop web screen recording with microphone narration (docs/plans/web-screen-audio-recording.md).
 * LOCAL ONLY: the bytes live in this page's memory as a Blob behind one object URL. Nothing is
 * uploaded, stored (no localStorage or IndexedDB) or sent anywhere, and nothing here calls the
 * network.
 *
 * Invariants (pqa-qa threat review r1):
 * - T1, T2: `start()` is called only from the Start button's press, and its first statement calls
 *   `getDisplayMedia`, so the click's transient activation reaches it (MDN). The microphone is asked
 *   for only after a screen is chosen.
 * - T3: if the microphone fails, the screen share is stopped. Video is never recorded without the
 *   narration the user expects.
 * - T4: every request carries a generation number. An answer that arrives after a dispose, discard
 *   or new start stops its own tracks and changes nothing.
 * - T5: ONE stream (screen video plus one mic audio track) is built before recording and never
 *   changed. Adding or removing a track mid-recording fails with InvalidModificationError (W3C).
 * - T7, T8: every stop path keeps the draft, and stops every track exactly once. There is one object
 *   URL per draft, revoked on discard and on dispose.
 * - T9: a duration cap and a byte cap stop the recording cleanly and keep the draft.
 */

/** Ask for a tab first (still the user's choice), exclude this tab and system audio (narration only). */
export const DISPLAY_OPTIONS = {
  video: { displaySurface: 'browser' },
  audio: false,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'exclude',
  monitorTypeSurfaces: 'include',
} as const;
const MIC_OPTIONS = { audio: { echoCancellation: true, noiseSuppression: true }, video: false } as const;
/** In order of preference; the first the browser supports is used (MDN MediaRecorder.isTypeSupported). */
export const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'] as const;
export const MAX_DURATION_MS = 15 * 60_000;
export const MAX_BYTES = 500 * 1024 * 1024;
const TIMESLICE_MS = 1000;

type Track = { kind: string; stop(): void; addEventListener(t: 'ended', f: () => void): void; removeEventListener(t: 'ended', f: () => void): void };
type Stream = { getTracks(): Track[]; getVideoTracks(): Track[]; getAudioTracks(): Track[] };
type Recorder = {
  state: string;
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};
export type RecorderEnv = {
  mediaDevices: { getDisplayMedia(o: unknown): Promise<Stream>; getUserMedia(o: unknown): Promise<Stream> };
  MediaRecorder: { new (s: Stream, o: { mimeType: string }): Recorder; isTypeSupported(t: string): boolean };
  MediaStream: new (tracks: Track[]) => Stream;
  createObjectURL(b: Blob): string;
  revokeObjectURL(u: string): void;
  now(): number;
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
};

export type StopReason = 'user' | 'screen-ended' | 'mic-ended' | 'recorder-error' | 'max-duration' | 'max-size';
export type RecorderState =
  | { kind: 'ready'; notice: string | null }
  | { kind: 'requesting-screen' }
  | { kind: 'requesting-mic' }
  | { kind: 'recording'; elapsedMs: number; bytes: number }
  | { kind: 'stopping' }
  | { kind: 'review'; blob: Blob; url: string; mimeType: string; durationMs: number; size: number; endedBy: StopReason; fileName: string }
  | { kind: 'error'; message: string }
  | { kind: 'disposed' };

const NOTHING = 'Nothing was recorded.';
const NARRATION = 'Narration is required, so the screen share was stopped and nothing was recorded.';

function screenError(e: unknown): RecorderState {
  switch ((e as { name?: string })?.name) {
    case 'NotAllowedError':
      return { kind: 'ready', notice: `Screen sharing was cancelled or blocked. ${NOTHING}` };
    case 'NotFoundError':
      return { kind: 'error', message: `No screen, window or tab is available to share. ${NOTHING}` };
    case 'InvalidStateError':
      return { kind: 'error', message: `Sharing has to start from a direct click on the button. Try again. ${NOTHING}` };
    case 'NotReadableError':
      return { kind: 'error', message: `The browser or system couldn’t read the chosen screen. Try another tab or window. ${NOTHING}` };
    default:
      return { kind: 'error', message: `Screen sharing failed. ${NOTHING}` };
  }
}
function micError(e: unknown): string {
  switch ((e as { name?: string })?.name) {
    case 'NotAllowedError':
      return `Microphone access was blocked. ${NARRATION} Allow the microphone for this site and try again.`;
    case 'NotFoundError':
      return `No microphone was found. ${NARRATION}`;
    default:
      return `The microphone is in use or unavailable. ${NARRATION}`;
  }
}

export function chooseMimeType(isTypeSupported: (t: string) => boolean): string | null {
  return MIME_CANDIDATES.find((t) => isTypeSupported(t)) ?? null;
}

/** A fixed, safe name: no user or study text; the extension follows the recorded format. */
export function recordingFileName(mimeType: string, at: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `pocketqa-recording-${stamp}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

const live = new Set<WebScreenRecorder>();
/** Sign-out and account switches dispose every live recorder: no stream or bytes survive the session. */
export function disposeAllWebRecorders() {
  [...live].forEach((r) => r.dispose());
}

export class WebScreenRecorder {
  private s: RecorderState = { kind: 'ready', notice: null };
  private gen = 0;
  private tracks: Track[] = [];
  private detach: (() => void)[] = [];
  private recorder: Recorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private stoppedAt = 0;
  private endedBy: StopReason | null = null;
  private timer: unknown = null;
  private mime = '';
  private readonly env: RecorderEnv;
  private readonly onChange: (s: RecorderState) => void;
  private readonly maxDurationMs: number;
  private readonly maxBytes: number;

  constructor(env: RecorderEnv, opts: { onChange: (s: RecorderState) => void; maxDurationMs?: number; maxBytes?: number }) {
    this.env = env;
    this.onChange = opts.onChange;
    this.maxDurationMs = opts.maxDurationMs ?? MAX_DURATION_MS;
    this.maxBytes = opts.maxBytes ?? MAX_BYTES;
    live.add(this);
  }

  get state() {
    return this.s;
  }
  private set(s: RecorderState) {
    this.s = s;
    this.onChange(s);
  }

  /** Call ONLY from the Start button's press: the screen request must run inside the click. */
  start() {
    if (this.s.kind !== 'ready' && this.s.kind !== 'error') return;
    const gen = ++this.gen;
    // First statement that matters: nothing is awaited before the screen request (T2).
    const screen = this.env.mediaDevices.getDisplayMedia(DISPLAY_OPTIONS);
    this.set({ kind: 'requesting-screen' });
    screen.then(
      (display) => this.withScreen(gen, display),
      (e) => {
        if (gen === this.gen) this.set(screenError(e));
      },
    );
  }

  private withScreen(gen: number, display: Stream) {
    if (gen !== this.gen) return release(display.getTracks());
    const video = display.getVideoTracks()[0];
    if (!video) {
      release(display.getTracks());
      return this.set({ kind: 'error', message: `The browser returned no video to record. ${NOTHING}` });
    }
    this.tracks = [...display.getTracks()];
    this.set({ kind: 'requesting-mic' });
    this.env.mediaDevices.getUserMedia(MIC_OPTIONS).then(
      (mic) => this.withMic(gen, video, mic),
      (e) => {
        if (gen !== this.gen) return;
        this.releaseAll();
        this.set({ kind: 'error', message: micError(e) });
      },
    );
  }

  private withMic(gen: number, video: Track, mic: Stream) {
    if (gen !== this.gen) return release(mic.getTracks());
    const audio = mic.getAudioTracks()[0];
    this.tracks.push(...mic.getTracks());
    if (!audio) {
      this.releaseAll();
      return this.set({ kind: 'error', message: micError(null) });
    }
    const mime = chooseMimeType((t) => this.env.MediaRecorder.isTypeSupported(t));
    if (!mime) {
      this.releaseAll();
      return this.set({ kind: 'error', message: `This browser can’t record video. ${NOTHING}` });
    }
    // T5: one stream, built once, before recording starts.
    const stream = new this.env.MediaStream([video, audio]);
    let rec: Recorder;
    try {
      rec = new this.env.MediaRecorder(stream, { mimeType: mime });
      this.mime = rec.mimeType || mime;
      this.chunks = [];
      this.bytes = 0;
      this.endedBy = null;
      rec.ondataavailable = (e) => this.onData(gen, e.data);
      rec.onerror = () => this.finish(gen, 'recorder-error');
      rec.onstop = () => this.finalize(gen);
      rec.start(TIMESLICE_MS);
    } catch {
      this.releaseAll();
      return this.set({ kind: 'error', message: `The browser couldn’t start recording. ${NOTHING}` });
    }
    this.recorder = rec;
    this.startedAt = this.env.now();
    const onScreenEnd = () => this.finish(gen, 'screen-ended');
    const onMicEnd = () => this.finish(gen, 'mic-ended');
    video.addEventListener('ended', onScreenEnd);
    audio.addEventListener('ended', onMicEnd);
    this.detach = [() => video.removeEventListener('ended', onScreenEnd), () => audio.removeEventListener('ended', onMicEnd)];
    this.timer = this.env.setInterval(() => this.onTick(gen), 500);
    this.set({ kind: 'recording', elapsedMs: 0, bytes: 0 });
  }

  private onData(gen: number, data: Blob) {
    if (gen !== this.gen || !data || data.size === 0) return;
    this.chunks.push(data);
    this.bytes += data.size;
    if (this.s.kind !== 'recording') return;
    if (this.bytes >= this.maxBytes) return this.finish(gen, 'max-size');
    this.set({ kind: 'recording', elapsedMs: this.env.now() - this.startedAt, bytes: this.bytes });
  }

  private onTick(gen: number) {
    if (gen !== this.gen || this.s.kind !== 'recording') return;
    const elapsedMs = this.env.now() - this.startedAt;
    if (elapsedMs >= this.maxDurationMs) return this.finish(gen, 'max-duration');
    this.set({ kind: 'recording', elapsedMs, bytes: this.bytes });
  }

  /** User Stop. */
  stop() {
    this.finish(this.gen, 'user');
  }

  /** Every stop path comes here once; the recorder's own stop event then finalizes the draft. */
  private finish(gen: number, why: StopReason) {
    if (gen !== this.gen || this.s.kind !== 'recording' || !this.recorder) return;
    this.endedBy = why;
    this.stoppedAt = this.env.now();
    this.clearTimer();
    this.set({ kind: 'stopping' });
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private finalize(gen: number) {
    if (gen !== this.gen) return;
    if (!this.endedBy) {
      // The recorder stopped on its own (for example every track ended).
      this.endedBy = 'recorder-error';
      this.stoppedAt = this.env.now();
    }
    this.clearTimer();
    this.releaseAll();
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: this.mime });
    this.chunks = [];
    if (blob.size === 0) return this.set({ kind: 'error', message: `The recording had no data. ${NOTHING}` });
    const url = this.env.createObjectURL(blob);
    this.set({
      kind: 'review',
      blob,
      url,
      mimeType: this.mime,
      durationMs: this.stoppedAt - this.startedAt,
      size: blob.size,
      endedBy: this.endedBy,
      fileName: recordingFileName(this.mime, new Date(this.stoppedAt)),
    });
  }

  /** Delete the draft (or clear an error) and return to ready. */
  discard() {
    if (this.s.kind === 'review') this.env.revokeObjectURL(this.s.url);
    if (this.s.kind === 'review' || this.s.kind === 'error') {
      this.gen++;
      this.set({ kind: 'ready', notice: null });
    }
  }

  /** Unmount, sign-out or page hide: stop everything and keep nothing. Idempotent. */
  dispose() {
    if (this.s.kind === 'disposed') return;
    this.gen++;
    this.clearTimer();
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
    }
    this.releaseAll();
    this.chunks = [];
    if (this.s.kind === 'review') this.env.revokeObjectURL(this.s.url);
    live.delete(this);
    this.set({ kind: 'disposed' });
  }

  private clearTimer() {
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
  }
  /** Stops each held track exactly once and detaches the ended listeners. */
  private releaseAll() {
    this.detach.forEach((d) => d());
    this.detach = [];
    release(this.tracks);
    this.tracks = [];
  }
}

function release(tracks: Track[]) {
  tracks.forEach((t) => t.stop());
}

type Globals = {
  isSecureContext?: boolean;
  MediaRecorder?: { isTypeSupported(t: string): boolean };
  navigator?: { userAgent?: string; maxTouchPoints?: number; userAgentData?: { mobile?: boolean }; mediaDevices?: { getDisplayMedia?: unknown; getUserMedia?: unknown } };
};
const ALTERNATIVE = 'Use a recent Chrome, Edge or Firefox on a computer, or attach screenshots or clips instead.';

/**
 * Desktop browsers only. Mobile is detected on purpose: Chrome for Android exposed
 * getDisplayMedia for years while it always failed (MDN browser-compat-data), so the method's
 * presence proves nothing there.
 */
export function webRecordingCapability(g: Globals = globalThis as unknown as Globals): Capability {
  const nav = g.navigator ?? {};
  const ua = nav.userAgent ?? '';
  const mobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  if (mobile) return { available: false, reason: 'Screen recording in the browser works on a computer only; mobile browsers don’t support it. Use the Android app to record on a phone, or attach screenshots or clips.' };
  if (!g.isSecureContext) return { available: false, reason: 'Screen recording needs a secure (HTTPS) page.' };
  const md = nav.mediaDevices;
  if (typeof md?.getDisplayMedia !== 'function' || typeof md?.getUserMedia !== 'function') return { available: false, reason: `This browser doesn’t support screen sharing. ${ALTERNATIVE}` };
  const MR = g.MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function' || !chooseMimeType((t) => MR.isTypeSupported(t))) return { available: false, reason: `This browser can’t record video. ${ALTERNATIVE}` };
  return { available: true };
}

/** The real browser APIs (web only). The screen request stays a direct call, inside the click. */
export function browserRecorderEnv(): RecorderEnv {
  const g = globalThis as unknown as {
    navigator: { mediaDevices: RecorderEnv['mediaDevices'] };
    MediaRecorder: RecorderEnv['MediaRecorder'];
    MediaStream: RecorderEnv['MediaStream'];
    URL: { createObjectURL(b: Blob): string; revokeObjectURL(u: string): void };
  };
  return {
    mediaDevices: {
      getDisplayMedia: (o) => g.navigator.mediaDevices.getDisplayMedia(o),
      getUserMedia: (o) => g.navigator.mediaDevices.getUserMedia(o),
    },
    MediaRecorder: g.MediaRecorder,
    MediaStream: g.MediaStream,
    createObjectURL: (b) => g.URL.createObjectURL(b),
    revokeObjectURL: (u) => g.URL.revokeObjectURL(u),
    now: () => Date.now(),
    setInterval: (f, ms) => setInterval(f, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
}
