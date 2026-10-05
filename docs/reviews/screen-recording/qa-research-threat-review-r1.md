# pqa-qa: desktop web screen + microphone recording, research and threat review r1

**Base:**
- `main` is `6028f08cb8249d2e9b13d93ba4a9c415c2ad5531`.
- The lead implements in `.worktrees/screen-recording`.
- I review from my own worktree `.worktrees/qa-screen-recording` (branch `review/qa-screen-recording`, docs-only files).

**Scope (from the task):** web screen and mic recording that must provide:
- explicit per-session consent, through the OS/browser chooser;
- mic narration;
- record, stop, replay, download and discard;
- **local browser bytes only, with no automatic upload**.

Out of scope: AI analysis and console capture. The shared demo's upload prohibitions stay intact. Native (Android MediaProjection) must not regress.

This is the pre-implementation review. The final verdict needs an exact frozen SHA plus my own real-browser run.

## Sources (primary)
- **[S1] MDN `MediaDevices.getDisplayMedia()`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia:
  - secure contexts only;
  - **transient user activation required** ("the call must be made from code running due to transient activation, such as an event handler");
  - `InvalidStateError` if not under activation;
  - `NotAllowedError` on user denial **or a Permissions-Policy block** (`display-capture`);
  - `NotFoundError`, `NotReadableError`, `AbortError`, and `TypeError` (for example `video:false`);
  - permission "cannot be persisted; user must be prompted every time";
  - options apply after the user's choice and can't limit it;
  - the returned stream "might contain no audio track even when `audio: true`";
  - `selfBrowserSurface`, `surfaceSwitching`, `systemAudio`, `monitorTypeSurfaces`;
  - limited availability: Safari limited, mobile browsers generally unsupported.
- **[S2] MDN `MediaDevices.getUserMedia()`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia:
  - secure contexts only;
  - in an insecure context `navigator.mediaDevices` is `undefined`;
  - Permissions-Policy `microphone`;
  - errors: `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, `AbortError`, `SecurityError`, `TypeError`;
  - **"the returned promise [may] neither resolve nor reject"**, because the user may ignore the prompt;
  - browsers show in-use indicators;
  - release devices with `track.stop()`.
- **[S3] MDN `MediaRecorder`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder:
  - `isTypeSupported()`;
  - the `dataavailable`, `stop` and `error` events;
  - `start(timeslice)`.
- **[S4] MDN `MediaRecorder.start()`**, https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start:
  - `InvalidStateError` if not inactive;
  - `NotSupportedError` if the stream is inactive or a track can't be recorded;
  - `SecurityError`;
  - "timeslice is not exact".
- **[S5] W3C MediaStream Recording**, https://www.w3.org/TR/mediastream-recording/:
  - **if a track is added to or removed from the stream's track set, the UA must stop gathering data and fire `error` (`InvalidModificationError`), then `dataavailable`, then `stop`**;
  - when all tracks end, a final `dataavailable` fires, then `stop`;
  - encoding can consume large resources (a DoS note);
  - codec probing is a fingerprinting surface.
- **[S6] MDN `MediaStreamTrack: ended` event**, https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event:
  - fires when permission is revoked, the source is removed, and so on (this includes the browser's own **"Stop sharing"** bar);
  - **not fired by `track.stop()`**.
- **[S7] MDN `URL.revokeObjectURL()`**, https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static: call it when finished with an object URL so the browser stops keeping the reference. See also `URL.createObjectURL()`.
- **[S8] MDN `AudioContext.createMediaStreamDestination()`**, https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination: a single mixed audio stream for `MediaRecorder`.

## Repo facts found now (base `6028f08`)
- **F1, a blocker for the feature as specified.**
  - **What the headers say:** both web servers send `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()`. That's `scripts/preview/gate-server.mjs:124` and `scripts/production/web-server.mjs:74`.
  - **Effect on the mic:** `microphone=()` disables the mic for every origin, so `getUserMedia({audio})` rejects with `NotAllowedError` on the preview and in production [S2].
  - **Effect on capture:** `display-capture` isn't listed, so it falls back to the default allowlist (`self`).
  - **Required:** `microphone=(self)` and an **explicit** `display-capture=(self)`, with `camera=()` and the rest unchanged, in both servers, with tests. The change needs a stated justification, because it widens the policy.
- **F2:** the CSP already allows `media-src 'self' blob:`, so playback of a blob URL works. No `connect-src` change is needed, and **none must be added**: local bytes only.
- **F3:** the native recorder (`apps/mobile/src/evidence/recorder.ts`, MediaProjection) and the segment upload queue (`segments.ts`, `uploadQueue`) exist. The web recorder must **not** feed `uploadQueue` (no automatic upload). The native path must stay byte-for-byte unchanged in behaviour.

## Threat and failure model, with acceptance criteria (each a test or a live check)
| # | Risk | Requirement | Evidence I'll want |
|---|---|---|---|
| T1 | Covert or implicit capture | `getDisplayMedia` is called only **synchronously inside the click handler** of an explicit "Share screen and start" button, after a visible consent step for this session (what's captured, mic on or off, local only, how to stop). No auto-start on mount, retry or focus. A prior consent never carries to a new session [S1] | Unit tests: no call outside the handler. Playwright: no call without a click. Copy review |
| T2 | User gesture lost by an `await` before `getDisplayMedia` | No awaited work before the call (permissions query, mic first, state persistence). Order: `getDisplayMedia` first, then the mic. Otherwise `InvalidStateError` in Chrome [S1] | A Playwright run with real Chromium; a unit test on call order |
| T3 | Mic failure leaves the screen being captured | If the mic is declined or fails (`NotAllowedError`, `NotFoundError`, `NotReadableError`), the display tracks are stopped or a "screen only" choice is offered **explicitly**. Never a silent continue without saying narration is off | A test where the mic rejects after display resolves: display tracks stopped (or an explicit fallback state) |
| T4 | A mic or display promise that never settles (ignored prompt [S2]), or cancel / unmount / logout mid-await | Each started request has a generation token. A late resolve after cancel, unmount or logout **stops its tracks right away** and changes no state | Tests with a deferred resolve after unmount or logout: `track.stop()` called, no `setState` |
| T5 | Track-set mutation | Build **one** `MediaStream` (display video plus **a single** audio track) **before** `start()`. Never add or remove tracks while recording, which triggers `InvalidModificationError` [S5]. To keep both narration and tab audio, mix them through `AudioContext.createMediaStreamDestination()` [S8], or record narration only, stated plainly. Several raw audio tracks risk one being dropped by the UA | Real-browser recording, then `ffprobe`: one video plus one audio stream, with audible narration (a synthetic tone energy check) |
| T6 | MIME/codec | Choose with `MediaRecorder.isTypeSupported` from an ordered list (`video/webm;codecs=vp9,opus`, `vp8,opus`, `video/webm`, `video/mp4`) [S3]. The blob type is the recorder's actual `mimeType`. The download extension follows it. Unsupported → a clear "unavailable" state | `ffprobe` codec names. A test of the choice order |
| T7 | Stop paths | User Stop; the browser "Stop sharing" bar (video track `ended` [S6]); a mic `ended`; recorder `error` [S5]; route change or unmount; logout or account switch; tab hidden or unload. **All** paths stop every track (display, mic, mixer, AudioContext closed) exactly once, and are idempotent. Bytes kept from a system stop are shown as a draft, never discarded silently | Tests per path. Live: end the synthetic display track and check the draft appears |
| T8 | Object URL lifecycle | One URL per draft. Revoked on discard, on a new recording, on unmount and on logout [S7]. Replay and download use the same blob. No URL kept after discard | Spy on `create`/`revokeObjectURL` counts (balanced) |
| T9 | Memory and DoS [S5] | A hard cap on duration and/or bytes (chunk sum), with `start(timeslice)` used to count. On the cap: stop cleanly, keep the draft, say why. Chunks released on discard | A test with a synthetic chunk size reaching the cap |
| T10 | No upload / exfiltration | The web recording never enters `uploadQueue`, `fetch` or `XMLHttpRequest`. No new `connect-src`. Shared-demo evidence-upload refusals unchanged (smoke checks). Download is a user-clicked `<a download>` of a local blob | A grep and a network-request assertion in Playwright (0 requests carrying the blob) |
| T11 | Privacy copy | Before the share: the whole screen, window or tab may show other apps, notifications and passwords, so close sensitive things. Choose a tab or window. Mic narration on or off. Stays on this device; nothing uploaded; download is your choice; discard deletes it from this page. A persistent "Recording, Stop" indicator in-app, alongside the browser's own | Copy review, screenshots light and dark |
| T12 | Capability gating | Unsupported (no `mediaDevices.getDisplayMedia`, insecure context, mobile web, Safari quirks, no `MediaRecorder`) shows an honest "not available in this browser" message, not a broken button. Native unchanged | Tests with globals removed. Native jest suite unchanged |
| T13 | Self-capture and feedback | `selfBrowserSurface: 'exclude'` is advisable (it avoids an infinite mirror). Replay `<video>` muted by default during recording; no live monitor of the mic | Code review |
| T14 | Download naming | A fixed safe filename (no user or study text unescaped), the correct extension, nothing beyond the blob | Test |
| T15 | Permissions-Policy (F1) | `microphone=(self)` and `display-capture=(self)`, camera still `()`, in both servers, tested. The production CSP unchanged otherwise | `preview-scripts`/production header tests; a live header check on the rehearsal |

## How I'll test the frozen candidate (no real screen or audio)
- **Real browser engine.** Playwright Chromium with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and, where needed, `--auto-select-desktop-capture-source` or `--auto-accept-this-tab-capture`. A synthetic mic (fake device tone, or an injected `AudioContext` oscillator), a synthetic display (a fake capture source, or a canvas `captureStream()` stub only where Chromium can't fake display).
  - **The real `MediaRecorder` runs on these**, then the blob is saved through the app's own **download** button.
  - **This captures no real screen or microphone.** The fake-device flags replace the real devices.
- **ffprobe / ffmpeg** on the downloaded file: container, codecs, duration greater than 0, one video and one audio stream. Audio RMS is above silence for the narration tone. Decodable end to end (`ffmpeg -v error -i f -f null -`).
- **Replay** in the page, checking that `video.duration` is finite and greater than 0 after metadata loads.
- **Plus:**
  - `pnpm verify`;
  - full Playwright;
  - native jest unchanged;
  - preview smoke (upload prohibitions);
  - header checks;
  - UX screenshots light and dark.

## Initial status
No candidate yet. **F1 is a known required change** (the mic is blocked by the shipped Permissions-Policy). T1–T15 are the acceptance bar, and any P0/P1/P2 blocks.
