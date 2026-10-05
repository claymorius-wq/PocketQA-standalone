# Web screen recorder: usability guide and evidence

**Feature:** a tester on a **desktop** browser can record a tab, window or screen they choose, with **microphone narration**, during their session. They replay it, then download it or discard it.

**Local only:** nothing is uploaded or stored, and nothing is sent to AI. AI feedback and console-log collection are future work and **not** part of this build.

Plan and citations: `docs/plans/web-screen-audio-recording.md`.

## How a tester uses it
1. **Open the session.** Open Work, then the in-progress session. The **Evidence** section shows **"Record this session in your browser"**, with the privacy note:
   - everything visible in what you share is recorded, including other apps, notifications and passwords;
   - choose a single tab or window;
   - only your microphone's narration is recorded, not the tab's or computer's sound;
   - the recording stays on this device, and is never uploaded.
2. **Give this session's consent.** Tick *"For this session, I agree to share a screen I choose and to record my microphone for narration."* Until then, **Share screen and start recording** stays disabled. Leaving the session resets the tick.
3. **Choose what to share.** Press **Share screen and start recording**. The browser's own dialog asks what to share (a tab is offered first; the Pocket QA tab itself is excluded). The browser asks this every time. Then it asks for the **microphone**.
4. **While recording**, the card says **"Recording · mm:ss / 15:00"**, and the browser shows its own sharing indicator. Stop it with **Stop recording** here, or with the browser's own **Stop sharing**.
5. **Review.** The draft shows its length and size. Play it in the page with sound. Then:
   - **Download recording** saves `pocketqa-recording-YYYYMMDD-HHMMSS.webm` (`.mp4` in browsers that only record MP4) to your downloads, by your click;
   - **Discard recording** deletes it from the page.
   
   A new recording starts only after the draft is discarded, so nothing is lost silently.

## States the tester can meet
| Situation | What the tester sees |
|---|---|
| Phone or tablet browser | "Screen recording in the browser works on a computer only; mobile browsers don't support it. Use the Android app to record on a phone, or attach screenshots or clips." |
| Page not on HTTPS, or the browser lacks screen sharing or `MediaRecorder` | An honest "not available" reason, with the attach option still there |
| The share dialog is cancelled | "Screen sharing was cancelled or blocked. Nothing was recorded." Start stays available |
| The tester presses **Cancel** while the browser is asking (share dialog or microphone prompt) | "Cancelled. Nothing was recorded." Any screen already chosen is released. Browsers may leave a prompt unanswered forever (MDN), so Cancel is always offered while asking |
| The browser's **Stop sharing** while the microphone prompt is still open | "You stopped sharing before recording started. Nothing was recorded." The screen is released |
| The microphone is blocked or missing | The screen share **is stopped**: "… Narration is required, so the screen share was stopped and nothing was recorded …". Try again after allowing the mic |
| The browser's **Stop sharing**, the mic unplugged, or a browser error | Recording ends and the **draft is kept**, with the reason shown |
| 15 minutes or 500 MB reached | Recording stops and the **draft is kept**, with the reason shown |
| Leaving the session, signing out, or closing the page | Screen and mic are released; nothing is kept |
| The page comes back from the browser's back/forward cache after being hidden | "This recording was closed (the page was hidden or you signed out). Nothing was kept." **Start over** gives a fresh recorder and asks for consent again |

## Evidence (this candidate)
- **Unit and component tests** (`apps/mobile/__tests__/web-screen-recorder.test.ts`, 39; `web-recorder-card.test.tsx`, 12):
  - RED before the code;
  - **14/14 mutants caught** in the controller's safety checks (`tdd.txt`).
- **Headers:** both web servers now send `permissions-policy: camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=()`. This is pqa-qa F1: the previous `microphone=()` would block the mic on the preview and in production. RED, then GREEN.
- **Real Chromium** (`apps/mobile/e2e/web-recorder.spec.ts`, Desktop Chrome project, 4/4):
  - the screen request happens **inside the click** (user activation active), and the mic only after it;
  - a 3.5 s recording;
  - **ffprobe:** one VP9 1280×720 video stream plus one Opus 48 kHz audio stream;
  - **ffmpeg** decodes it with no errors;
  - **narration level:** mean −21.3 dB, not silence (`ffprobe.txt`);
  - **in-page replay:** duration 3.9 s; playback advances;
  - **download** through the app's button, under the safe name;
  - **no request carried data**: no POST or PUT, nothing with a body;
  - **Discard** revokes the blob URL;
  - the browser's Stop sharing keeps the draft;
  - a refused mic stops the screen track, and nothing is recorded;
  - leaving the session (an in-app navigation, same document) releases both devices.
- **Full suite:**
  - `pnpm verify` EXIT=0 (`verify.txt`);
  - Playwright 19/19 (`playwright.txt`): the 15 mobile-web flows still show the honest "computer only" message, plus the 4 recorder tests.
- **Screenshots:** consent (light), recording (light and dark), review (light and dark), mic refused (light).

## Known limitation: no duration in the WebM header
Chrome's `MediaRecorder` writes WebM without a duration in the header, so ffprobe reports `duration=N/A` for the file.
- **Players are unaffected:** the browser's player, VLC and ffmpeg compute the length while reading. pqa-qa measured A/V end timestamps of 11.999 s and 12.101 s for a 12 s recording.
- **The in-page player** may show its length only once played or seeked; the test seeks to the end to read 3.9 s.
- **When decoding to the null muxer,** ffmpeg can note "non monotonically increasing dts"; that concerns the discarded output, not decoding.
  - The decode gate tolerates only that exact line from the null muxer (`apps/mobile/e2e/ffmpegCheck.ts`, unit-tested).
  - Anything else fails: another stderr line, a decoder or demuxer error, or a nonzero exit.
- **Possible future fix:** rewrite the header (remuxing) before download. Not in this MVP.

## Public preview smoke (synthetic, non-destructive)
`scripts/preview/recorder-smoke.mjs` runs headless Chromium with fake media devices, so no real desktop or microphone is captured. It reads the gate password and the demo tester's sign-in from `.preview/access.txt` and never prints them. It checks:
1. The `permissions-policy` header: microphone and display capture for self, camera off.
2. Gate login, and sign-in as the demo tester.
3. That a demo study page says "Browser recording available". If the tester has no open study, this is reported as INFO and skipped.
4. A 1.5 s synthetic capture-and-record probe on the real origin, through a real click.
   - **This is not the app's recorder.** It's a script injected into the page that calls the browser APIs directly, to prove the deployed origin's policy and the browser engine.
   - The in-app recorder card (consent, Cancel, Stop, replay, download, discard) is covered only by the local desktop Playwright project (`apps/mobile/e2e/web-recorder.spec.ts`).
   - Stop sharing is simulated there.

It creates or joins nothing and changes no data:
- **Join mode rejected:** an earlier join-and-withdraw mode was tried in rehearsal and dropped, because a withdrawn participation can't be re-joined. It would leave the shared demo tester with no studies.
- **Rehearsal:** on fresh synthetic data, the existing `smoke.mjs` passed before and after two recorder-smoke runs (`preview-smoke-rehearsal.txt`).

```
PREVIEW_URL=https://pocketqa.optijara.ai node scripts/preview/recorder-smoke.mjs
```
Run it after deployment from a machine with the preview's `.preview/access.txt`, with Playwright's Chromium installed.

## What these tests do not prove
The browser tests use **Chromium's fake media devices**:
- `--use-fake-ui-for-media-stream` auto-accepts the share dialog;
- the "screen" is a synthetic capture of a browser tab; in this harness it captured the Pocket QA tab itself, because the fake UI ignores the self-exclusion hint;
- the "microphone" is a generated tone.

So the following stayed **untested**:
- the **real OS or browser share dialog**, a **real microphone** and real screen content;
- **Safari** and **Firefox**;
- a **deployed HTTPS** origin with the new header.

A manual check after deployment, on the protected preview from a desktop Chrome:
1. Pick a **different tab** in the real dialog.
2. Narrate.
3. Press the browser's **Stop sharing**.
4. Replay with sound, then download.
5. Confirm the browser asked again on the next start.

## Shared preview
The recorder is local only, so it is allowed on the shared preview. **Nothing about evidence upload or sign-in changes there**: the preview still refuses uploads, and this feature never uploads anything. Two things are needed for the preview to use it:
- the header change, which ships with the merged code;
- an HTTPS origin, which the preview already is.
