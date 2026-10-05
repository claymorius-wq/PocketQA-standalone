# Web screen recording with microphone narration: research and plan

**Status:** plan for the build on `feat/screen-recording` (from `main` `6028f08`). Hamza authorised the task on 2026-10-05, relayed by the parent.

**Builder:** `pocketqa-lead` (`claude-opus-5-5`). **Independent review:** `pqa-qa`, whose research and threat review r1 (acceptance bar T1–T15) is in its worktree at `docs/reviews/screen-recording/qa-research-threat-review-r1.md`.

**Out of scope (future):**
- AI feedback on recordings;
- collecting console logs or network traffic;
- uploading web recordings as evidence;
- system or tab audio.

## Goal (MVP)
A discoverable **local-only** recorder in the tester's session screen on **desktop** browsers. It offers:
- explicit per-session consent;
- the browser's own chooser to pick a tab, window or screen;
- microphone narration (no camera, no system audio);
- a visible "recording" status with a timer, and Stop;
- replay with audio, then download or discard.

**All bytes stay in the browser.** There is no automatic upload, no media in localStorage or IndexedDB, no `fetch`, and no AI calls. Mobile browsers and unsupported browsers get an honest "not available" message. The Android MediaProjection recorder is unchanged.

## Sources (primary; checked 2026-10-05)
- **[M1] MDN `MediaDevices.getDisplayMedia()`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia:
  - "available only in secure contexts (HTTPS)";
  - "Transient user activation is required";
  - permission "cannot be persisted for reuse. The user must be prompted for permission every time";
  - errors: `NotAllowedError` (denied, or blocked by a Permissions Policy), `NotFoundError`, `InvalidStateError` (no transient activation), `NotReadableError`, `TypeError`, `AbortError`;
  - options `displaySurface`, `preferCurrentTab`, `selfBrowserSurface`, `surfaceSwitching`, `systemAudio`, `monitorTypeSurfaces`;
  - audio support "varies".
- **[M2] MDN "Using the Screen Capture API"**, https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture: a shared surface can contain "personal information" or a visible "password manager". Audio capture "is always optional", and a stream may come back with no audio track.
- **[M3] MDN `MediaDevices.getUserMedia()`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia:
  - secure contexts only;
  - controlled by the `microphone` Permissions Policy;
  - errors `NotAllowedError`, `NotFoundError` and `NotReadableError`;
  - the promise may neither resolve nor reject if the user ignores the prompt.
- **[M4] MDN `MediaRecorder`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder: `isTypeSupported()`, `start(timeslice)`, and the `dataavailable`, `stop` and `error` events.
- **[M5] W3C MediaStream Recording**, https://w3c.github.io/mediacapture-record/ (spec text read 2026-10-05):
  - "If at any point, a track is added to or removed from stream's track set, the UA MUST stop gathering data … Fire an error event named InvalidModificationError";
  - recording ends when the tracks end.
- **[M6] MDN `MediaStreamTrack: ended` event**, https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event: fired when the source ends, for example the browser's "Stop sharing" control; not fired by `track.stop()`.
- **[M7] MDN `URL.revokeObjectURL()`**, https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static: release object URLs when done.
- **[B1] MDN browser-compat-data**, `api/MediaDevices.json` → `getDisplayMedia`, fetched 2026-10-05:
  - supported: Chrome 72, Edge 79, Firefox 66, Safari 13;
  - **not supported:** `chrome_android` ("From Chrome Android 72 to 88, this method was exposed, but always failed with `NotAllowedError`"), `firefox_android` (the same, versions 66–79) and `safari_ios`.
  
  **The method existing therefore doesn't prove it works:** mobile must be detected as well. `MediaRecorder`: Chrome 47, Firefox 25, Safari 14.1.

## Repo facts
- **Web:** today `recordingCapability()` says recording isn't available on web, and the Evidence block offers "Attach screenshot or clip" (`apps/mobile/app/participation/[id].tsx`, `src/lib/capability.ts`).
- **Headers (pqa-qa F1):** `scripts/preview/gate-server.mjs:124` and `scripts/production/web-server.mjs:74` send `permissions-policy: camera=(), microphone=(), …`. That blocks `getUserMedia` on the preview and in production [M3].
- **CSP:** it already allows `media-src 'self' blob:`. No `connect-src` change is needed, and none will be made.
- **Kit `Button`:** it calls `onPress` synchronously from the press (`src/ui/button.tsx`), so the click's transient activation reaches `getDisplayMedia`.

## Feasibility (measured 2026-10-05, Playwright Chromium 1.63)
- **Setup:** the flags `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and `--auto-accept-this-tab-capture`; an `https://` routed page (a secure context); a real click.
- **Results:**
  - `getDisplayMedia({video:{displaySurface:'browser'}})` returned a tab track;
  - `getUserMedia({audio:true})` returned "Fake Default Audio Input";
  - `MediaRecorder` chose `video/webm;codecs=vp9,opus` (`video/mp4` was also supported);
  - ffprobe: **vp9 1280×720 video plus opus 48 kHz mono audio**; ffmpeg volumedetect mean −21.5 dB, so the audio isn't silent.
- **What this proves:** real browser encoding, from synthetic inputs.
- **What it doesn't test:** a real OS screen chooser, a real microphone, Safari, or Firefox.

## Design
### Capability, `webRecordingCapability()` in `src/evidence/webScreenRecorder.ts`
Available only when **all** of these hold:
- `Platform.OS === 'web'`;
- `isSecureContext`;
- `navigator.mediaDevices.getDisplayMedia` and `getUserMedia` exist;
- `MediaRecorder` exists, with a supported MIME type;
- the browser is **not mobile**: `navigator.userAgentData.mobile === true`, or a mobile/tablet UA token (Android, iPhone, iPad, iPod, Mobile; an iPadOS desktop UA with touch points), because of [B1].

Each failure has its own honest reason. The native path keeps using `recordingCapability()` unchanged.

### Controller, `WebScreenRecorder`: a framework-free class with injected browser APIs, unit-tested with fakes
**States:**
- `ready`;
- `requesting-screen`;
- `requesting-mic`;
- `recording` (elapsed time and bytes);
- `stopping`;
- `review` (blob, object URL, MIME, duration, size, why it stopped);
- `error` (message, retryable);
- `disposed`.

**Start**, in this order (T1, T2):
1. `start()` is called only from the Start button's press. Its **first statement** calls `getDisplayMedia({video:{displaySurface:'browser'}, audio:false, selfBrowserSurface:'exclude', surfaceSwitching:'include', systemAudio:'exclude', monitorTypeSurfaces:'include'})`, so nothing is awaited before it.
2. Only after the screen is chosen does it call `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}, video:false})`.

**Microphone failure (T3):** if the mic is denied or fails, every display track is stopped, and the state becomes `error`, retryable: "Microphone needed for narration … nothing was recorded". Video is never recorded silently without audio.

**Generation token (T4):** `start()`, `dispose()`, discard and a new start each bump a generation counter. A promise that settles under an old generation stops its own tracks at once and changes nothing.

**One stream (T5):** `new MediaStream([displayVideoTrack, micAudioTrack])` is built once, before `start()`, and never changed (it would fail with `InvalidModificationError` [M5]). The audio is narration only; tab and system audio aren't recorded, and the UI says so.

**MIME (T6):** the first supported type, in order:
1. `video/webm;codecs=vp9,opus`
2. `video/webm;codecs=vp8,opus`
3. `video/webm`
4. `video/mp4;codecs=avc1,mp4a`
5. `video/mp4`

The blob type is `recorder.mimeType` (or the chosen type), and the download extension follows it (`.webm` or `.mp4`).

**Stop paths (T7)** all finalise exactly once and keep the bytes as a draft:
- Stop pressed;
- the display track's `ended` event (the browser's "Stop sharing");
- the mic track's `ended` event;
- the recorder's `error`;
- the duration or size cap.

**Teardown:** unmount, sign-out (`disposeAllWebRecorders()` from the session `clear()`) and `pagehide` dispose the recorder. That stops every track and drops the bytes.

**A hidden tab does not stop recording.** Testers record the app under test in another tab while working in it.

**Object URLs (T8):** one per draft, created at review and revoked on discard, a new start, or dispose.

**Caps (T9):** `start(1000)`. Chunk sizes are summed; at 15 minutes or 500 MB the recorder stops cleanly, keeps the draft, and says why.

**No upload (T10):** the recorder never touches `uploadQueue`, `fetch` or XHR. Download is a user-clicked `<a download>` of the local object URL.

**Filename (T14):** `pocketqa-recording-YYYYMMDD-HHMMSS.webm` (or `.mp4`), with no user or study text.

### UI, `WebRecorderCard` (web only)
It replaces "Recording unavailable" in the session's Evidence block when the capability is available. Otherwise the honest reason is shown, and Attach stays.

**Consent:** a per-session checkbox. It resets when the screen unmounts, and is required before "Share screen and start recording".

**Privacy copy (T11):**
- Everything visible in what you share is recorded: other apps, notifications, passwords.
- Prefer a single tab or window over the whole screen.
- Narration comes from your microphone; tab or system sound isn't recorded.
- The recording stays on this device: it isn't uploaded; downloading is your choice; Discard deletes it from this page.

**While recording:** a "Recording · mm:ss / 15:00" status with a live region, and Stop. The browser's own sharing indicator stays too.

**Review:** a native `<video controls>` on the blob URL (unmuted, so the narration plays), Download and Discard.

**Shared preview:** the local-only recorder is allowed there. Evidence upload and auth restrictions are unchanged, because nothing is uploaded.

### Headers (F1, T15)
Both web servers send `permissions-policy: camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=()`. The camera stays off. This widens the policy only for the same origin, which the recorder needs [M1][M3]. CSP and `connect-src` are unchanged.

## Test plan (strict red, then green)
1. **Unit** (`apps/mobile/__tests__/web-screen-recorder.test.ts`), with fake `mediaDevices`, `MediaRecorder`, `URL` and clock:
   - call order: display before mic, and display called synchronously within `start()`;
   - success, then stop, then review with a balanced URL;
   - chooser cancel (`NotAllowedError`), then back to ready with a message;
   - mic denied: display tracks stopped, retryable error;
   - a late resolve after dispose or discard, for both display and mic: tracks stopped, no state change;
   - browser "Stop sharing" (display `ended`) and a mic `ended`: a draft is kept;
   - a recorder `error`: the draft is kept, with a reason;
   - MIME order and none-supported;
   - the duration cap and the byte cap;
   - double start ignored; idempotent stop and dispose;
   - `disposeAllWebRecorders`;
   - the filename;
   - capability (insecure context, missing APIs, mobile UA and `userAgentData`, iPadOS, desktop available).
2. **Component** (`apps/mobile/__tests__/web-recorder-card.test.tsx`): consent gating; privacy copy; recording status and timer; review with Download and Discard; the unsupported reason; locked sessions.
3. **Server headers:** `scripts/preview-scripts.test.mjs` and the production web-server test assert the new `permissions-policy`.
4. **Real browser** (`apps/mobile/e2e/web-recorder.spec.ts`, a Desktop Chrome project with fake devices):
   - a tester opens a session, consents, starts, records about 3 s, stops, replays (`video.duration` finite and above 0), then downloads through the UI;
   - ffprobe (one video plus one audio stream), an ffmpeg decode with no errors, and volumedetect above silence;
   - **no request carries the recording** (network log);
   - a variant where the display track is ended by the page itself (standing in for "Stop sharing") keeps the draft.
5. **Regression:** full `pnpm verify`, full Playwright (the mobile-emulated project still shows the honest mobile message) and the native jest suites unchanged.

**What stays untested here:**
- the real OS/browser chooser UI;
- a real microphone and real screen content;
- Safari and Firefox engines;
- a real HTTPS deployment. A post-merge preview check is listed in the usability guide.
