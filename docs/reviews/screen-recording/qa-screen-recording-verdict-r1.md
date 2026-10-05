# pqa-qa: desktop web screen + microphone recording, verdict r1

**Candidate:** `9b9d6317a6b7d23f49128afcf07beeed5aff0a23` (`feat/screen-recording`). The delta is `git diff 6028f08..9b9d631`: 28 files, 2 commits. It's measured against my `qa-research-threat-review-r1.md` (T1–T15).

**Setup:**
- I worked in my own detached worktree `.worktrees/qa-sr-run` on Node v24.21.0, installed with `pnpm install --frozen-lockfile --offline`.
- **Synthetic media only:** Chromium's fake-device and fake-UI flags. No real screen, window, tab content or microphone was captured.
- No cloud, network sends, push or deploy.
- My temporary probe spec, mutants and Playwright artefacts were removed. The tree is clean.

## Gates and probes I ran
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. check:secrets 892 files, no findings. Scripts 60; contracts 17; domain 216; API 573 + 2 skipped; mobile **1129** |
| Playwright, full (`mobile-web` + `desktop-recorder`) | **PW_EXIT=1: 18 passed, 1 failed.** The failure was `web-recorder.spec.ts:94`, at `expect(decode.stderr.trim()).toBe('')`. It received `[null @ …] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 2 >= 2` (see P2-2) |
| `--project=desktop-recorder` rerun 3× | 4/4, 4/4, 4/4. So the failure is **intermittent**: 1 of my 4 runs of that test failed, and that run was under full-suite load |
| **QA-A**, my probe: `getUserMedia` never settles (MDN: the prompt "may neither resolve nor reject") | After the screen is chosen, the state stays at **"Allow the microphone…" indefinitely**. The **screen track stays `live`**. The only button is the disabled "Share screen and start recording": **no Cancel**. When I then fire the browser's "Stop sharing" (`ended` on the screen track), **nothing changes**: same status, Start still disabled, track still live. Only leaving the screen releases it (P2-1) |
| **QA-B**, my probe: a 12 s recording, download through the UI, discard, a second recording, then leave | Downloaded `pocketqa-recording-20261005-141951.webm` (273,338 B). Object URLs: **created 2, revoked 2, live 0**. Tracks after leaving: `video:ended`, `audio:ended`. The only non-GET request in the whole flow was the sign-in `POST /auth/login`, with **nothing during record, download or discard**. Consent stays checked for a second recording in the same session (per-session, as designed) |
| **ffprobe / ffmpeg** on the QA-B file | `vp9` 1280×720 + `opus` 48 kHz mono, in `matroska,webm`. `ffmpeg -v error -i f -f null -` exits 0 with no output (this run). The last video pts is 11.999 s and the last audio pts 12.101 s, so they're aligned. Audio mean is −21.3, −20.8 and −20.8 dB over 0–4, 4–8 and 8–12 s: the synthetic narration runs throughout. Container `duration=N/A` (P3-1) |
| **My mutations** of `webScreenRecorder.ts` | (a) No `releaseAll()` on mic failure: **3 failed**. (b) A late mic answer after dispose no longer stops its tracks: **1 failed**. Both restored |

## T1–T15
| T | Status |
|---|---|
| T1/T2: consent, then `getDisplayMedia` as the first call inside the click, then the mic | ✅ code (`start()`, `Button` calls `onPress` synchronously). The e2e records `userActivation.isActive === true`. Start stays disabled until the per-session checkbox is ticked |
| T3: mic failure | ✅ the display is stopped and the error is retryable (e2e plus my mutation). Screen-only mode is deliberately not offered, and the copy says so |
| T4: late answers and never-settling prompts | ⚠️ late answers are handled by the generation token (tests plus my mutation). **A never-settling mic prompt leaves the share live with no way out** (P2-1) |
| T5: one stream, one audio track, built before `start()` | ✅. Narration only (`audio:false`, `systemAudio:'exclude'`); ffprobe shows exactly 1 video + 1 audio |
| T6: MIME | ✅ ordered `isTypeSupported`. The blob type and extension follow `rec.mimeType` |
| T7: stop paths | ✅ Stop, screen `ended`, mic `ended`, recorder error, the caps, unmount, sign-out (`disposeAllWebRecorders` in `clear`) and `pagehide`. Tracks released once. **Except during `requesting-mic`** (P2-1). Not stopping when the tab is hidden is a deliberate, justified deviation |
| T8: object URLs | ✅ balanced (QA-B). Revoked on discard and dispose; `fetch` after discard fails |
| T9: caps | ✅ 15 min / 500 MB, `start(1000)`, tested |
| T10: local only | ✅ no fetch, upload queue or `connect-src` change; my network capture is clean. The file-attach upload path is unchanged |
| T11: privacy copy and indicator | ✅ copy is accurate (narration only, nothing uploaded, choose a tab or window). Live timer; screenshots light and dark |
| T12: capability | ✅ desktop-only gating (mobile UA, `userAgentData`, iPadOS), secure context, APIs, MIME. The native branch is unchanged (diff adds only a web branch) |
| T13: self-capture | ✅ `selfBrowserSurface:'exclude'`, no live monitor |
| T14: file name | ✅ `pocketqa-recording-YYYYMMDD-HHMMSS.webm` |
| T15: Permissions-Policy | ✅ `camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=()` in both servers, tested. CSP unchanged |

## Findings
**P2-1: a never-answered microphone prompt leaves the screen share live with no way to cancel** (`webScreenRecorder.ts:167–184`, `WebRecorderCard.tsx:56,74–85`)
- **What happens:** between `withScreen` and the mic answer, the display tracks are held, but no `ended` listener is attached (listeners are attached only in `withMic`). The UI is `busy`, with Start disabled and no Stop or Cancel.
- **Why it happens:** MDN says the `getUserMedia` promise may never settle when the user ignores the prompt. That's realistic with Firefox's dismissible doorhanger, or a prompt hidden behind the shared window.
- **Effect (confirmed in real Chromium, QA-A):**
  - the browser keeps capturing the chosen screen with its sharing indicator on, while nothing records;
  - the user's own "Stop sharing" doesn't recover the card;
  - the only escape is leaving the session screen.
- **It isn't covert capture,** but it's a stuck device state and a privacy-relevant UX failure on one of T4's named paths.
- **Required:**
  1. A **Cancel** control in `requesting-screen` and `requesting-mic` that bumps the generation, releases every held track, and returns to `ready` with "Cancelled; nothing was recorded".
  2. An `ended` listener on the screen video **as soon as it's held** (in `withScreen`), so "Stop sharing" during the mic prompt does the same.
  3. Unit tests, plus a real-Chromium Playwright case with a never-settling `getUserMedia`, asserting the tracks end and Start becomes available again.

**P2-2: a required gate is flaky** (`apps/mobile/e2e/web-recorder.spec.ts:169`)
- **What happens:** `expect(decode.stderr.trim()).toBe('')` fails intermittently. Chrome's MediaRecorder WebM sometimes carries a duplicate video DTS, which ffmpeg's **null muxer** reports even though decoding succeeds (exit 0).
- **Effect:** the claimed "Playwright 19/19" isn't reproducible. My full run failed.
- **Required:**
  - Keep the strict decode check, but make it fail only on decoder or demuxer errors. For example, assert exit 0 and that stderr, **after removing that exact null-muxer DTS line**, is empty.
  - State this known upstream quirk in `ffprobe.txt` or the usability guide.
  - Show 3 consecutive green full runs.

**P3, non-blocking**
1. **No duration header in the downloaded file.** MediaRecorder WebM has no duration element: ffprobe shows `duration=N/A`, and the in-page replay needs the seek-to-end trick. Downloaded files may show an unknown length or seek poorly in some players. Document it in the usability guide; a duration fix-up is optional.
2. **Dead card after a back-forward-cache restore.** After a bfcache restore (`pagehide` with `persisted`), the recorder is `disposed` but the card still renders Start, and `start()` silently no-ops. Recreate the recorder on `pageshow`, or render a "reload to record again" notice.

## Limitations of this review (stated)
- **Synthetic media only.** The real OS/browser chooser and a real microphone permission prompt weren't exercised: the fake-UI flag auto-accepts them.
- **Chromium only.** Not tested: Firefox, Safari, Edge, real hardware, or deployed HTTPS on the preview.
- **"Stop sharing" was simulated** by dispatching `ended`. A real browser-bar stop wasn't driven.

## Verdict
**CHANGES_REQUIRED:** P2-1 (cancel and stop-sharing while a prompt is pending) and P2-2 (the flaky ffmpeg gate). Everything else meets T1–T15 on my independent evidence: real-Chromium recording, the UI download, ffprobe/ffmpeg, A/V alignment, narration present throughout, nothing sent, and balanced object URLs. Send me the fix SHA.

VERDICT: CHANGES_REQUIRED
