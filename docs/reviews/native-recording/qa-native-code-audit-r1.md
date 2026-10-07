# pqa-qa: native screen + voice recording, read-only code audit r1 (pre-freeze, not a verdict)

**Audited (committed code only, uncommitted WIP excluded):**
- **Android and shared JS:** `feat/native-voice-recording` at `e53b2889405aaa72ba972bbd89ed1d3a311c874e`, diff `ae0b501..e53b288`.
- **iOS:** `feat/native-voice-ios` at `d0a857b` (on top of `c648dd2`).

**How:** read-only. No builds, no emulator, no devices. This is **not** the frozen verdict: the exact frozen SHA still needs my device/emulator QA (checklist `qa-native-research-threat-review-r1.md`, N1–N13).

## What already meets the checklist (code)
**Android:**
- **Manifest and foreground service:** `foregroundServiceType="mediaProjection|microphone"`, with `FOREGROUND_SERVICE_MEDIA_PROJECTION`/`_MICROPHONE`, `RECORD_AUDIO` and `POST_NOTIFICATIONS`. `startForeground(…, MEDIA_PROJECTION or MICROPHONE)` runs **before** `getMediaProjection` (`ScreenCaptureService.kt:79–82,224`). The service is started from `OnActivityResult` while in the foreground (`ScreenCaptureModule.kt:96`).
- **Consent every session:** a fresh `createScreenCaptureIntent()` every session with no cached token (`:79`). `Callback.onStop` is registered before `createVirtualDisplay`, and one virtual display is created per token.
- **Microphone required:**
  - the JS asks for `POST_NOTIFICATIONS` (13+), then `RECORD_AUDIO`;
  - the module refuses without the mic (`MicDeniedException`), and so does the service (`:74`): there is **no video-only fallback**;
  - the copy says "Nothing was recorded".
- **Recorder:** `MIC` before `SURFACE`, AAC 44.1 kHz mono plus H.264, into app-private storage (`cacheDir/recordings`, not MediaStore).
- **Stop paths:** user (in-app and the notification action), system (chip, lock, revoke, destroy), mic (`isClientSilenced` for 2 s), error and limit all go through one guarded `finish()`.
- **Pending store:** the meta is written by a temp-file rename, so a crash never offers a half-written clip. Meta-less MP4s are swept (truncated or orphaned). Each clip is taken once per tag, and JS deduplicates by `uri` across the stopAsync, event and pending paths.

**iOS:**
- **Capture mechanism:** a Broadcast Upload Extension (`com.apple.broadcast-services-upload`, `RPBroadcastProcessModeSampleBuffer`) records **other apps** through `RPBroadcastSampleHandler`, not `RPScreenRecorder`.
- **Microphone only:** only `.audioMic` is written (`.audioApp` is ignored).
- **Writing:** AVAssetWriter streams to the App Group container.
- **No network:** the extension has no network code, guarded by a jest test.
- **Session tag:** a fresh session tag (five-minute TTL, consumed once) is required. A broadcast started from Control Centre is **refused**.
- **No microphone means nothing is kept:** all-zero mic buffers (ReplayKit sends continuous silence when the mic is off, per Apple) lead to a refusal.
- **Clean finish:** `finishWriting` is awaited before `broadcastFinished` returns.
- **Honest notes:** `ios-notes.md` says plainly that system broadcast **doesn't run in the Simulator**, that it needs a physical iPhone plus App Group provisioning for both bundle ids, and that **no "iPhone verified" claim** is made.

## Findings to resolve before freeze
**P2-A: an unmount during cross-app recording discards the session**
- **Where:** `participation/[id].tsx` unmount effect, which calls `discardAsync()` then `purgeAsync()`. On iOS the same thing happens through the Darwin "discard" notification.
- **Problem:** the feature's core flow is "start, switch to another app, come back". If Android destroys the activity while the tester is in the other app, the React root unmounts and the cleanup runs, silently deleting the in-progress recording. That can happen through memory pressure on low-RAM devices, the "Don't keep activities" developer option, or a configuration change while backgrounded.
- **Required:**
  - Don't discard an active native session on an unmount that happens while the app isn't `active`. Leave it to the pending store and claim it on return.
  - Discard only on an **explicit** in-app exit from the session while in the foreground.
  - **Evidence:** an emulator run with `adb shell settings put global always_finish_activities 1`: start, Home, use Settings, return. The clip must arrive for review.

**P2-B: the audio and video tracks must match before any "audio" claim**
- **Background:** the parent observed a **video 391 s / audio 202 s** file after rotation, and it is unexplained.
- **Required:**
  - The root cause must be found and fixed, or bounded with evidence.
  - Every evidence clip must pass an **A/V duration gate**: |audio − video| ≤ 1 s, read with `ffprobe` per stream.
  - Every evidence clip must also pass an **audio-signal gate**: with the synthetic tone injected, the RMS or mean is clearly above digital silence across the whole clip, checked in time windows.
  - Track presence alone is **not** accepted as "native mic in the file".
  - The rotation scenario must be one of the evidence runs.

**P3 (fix or document)**
1. **Possible crash on a failed start** (`ScreenCaptureService.kt:74–77`). On the precondition-failure path, after `startForegroundService()`, the service calls `stopSelf()` **without** `startForeground()`. Android can then throw `ForegroundServiceDidNotStartInTimeException` and crash the app. Call `startForeground` first, or validate everything before starting the service.
2. **Race between sweep and finish.** `cleanup()` clears `RecorderBridge.currentFile` **before** `markComplete` writes the meta (`:175–178`). A concurrent `purgeAsync`/`OnCreate` sweep in that window deletes the just-finished MP4. Clear `currentFile` after the meta is written.
3. **Cache storage can be evicted.** `cacheDir` can be cleared by the OS under storage pressure while a clip waits in the pending store. Prefer `noBackupFilesDir`.
4. **Silent loss after process death.** A process death (Task Manager "Stop", `force-stop`, a crash) truncates the file, and the next start deletes it **silently**. Tell the tester once: "A recording was interrupted and couldn't be saved."
5. **Lingering service on a stray Stop.** `ACTION_STOP` arriving with no active session (a stale notification) leaves a started service; call `stopSelf()`.
6. **Dismissible notification.** On Android 14+, users can dismiss the foreground-service notification, which removes the Stop action on devices without the Android 15 status-bar chip. The in-app Stop on return remains. Document this in the copy or guide.
7. **iOS orientation.** The `RPVideoSampleOrientationKey` attachment isn't applied (already disclosed): landscape apps record sideways.
8. **iOS picker workaround.** `button.sendActions(for: .allTouchEvents)` on `RPSystemBroadcastPickerView` is an undocumented workaround (Apple documents the picker as shown "when tapped"). It's acceptable because the user still confirms Start Broadcast, but it's App Review and OS-update fragile. Keep it disclosed.
9. **iOS mic thresholds.** `startGraceMs` 3 s and `lostAfterMs` are design values (disclosed); they need device tuning.

## What the frozen-candidate QA will require (unchanged from my checklist, plus the above)
**Android emulator (my own instance, host mic off, synthetic tone injected):**
- Cross-app frames showing the other app, from ffmpeg extraction at timestamps.
- Both A/V gates (P2-B).
- Notification Stop, in-app Stop, lock, mic revoke, `am kill`/`force-stop`, "Don't keep activities" (P2-A), rotation, and screen-consent and mic denial.
- No upload without an explicit action.
- Regression: `pnpm verify`, full Playwright, the Gradle build.

**Limits that will be stated:**
- **iOS:** build-only. No device, no "iPhone verified".
- **Seeker:** **not verified** without Seeker hardware.

## Addendum: `f95f145` (Android/JS WIP) and the lead's known blocker
**Reviewed (read-only):**
- `git diff e53b288..f95f145`: the session screen, the Maestro flows, `voice-lifecycle.sh`, the device-install guide, and the run-5 evidence `android-cross-app/probe.txt`.

**Run-5 evidence (read, not re-run). Accepted as an honest emulator claim:**
- **Streams:** h264 576×1280 for 230.37 s, and AAC 44.1 kHz mono for 229.65 s. That's within 1 s, so this clip **passes the A/V gate**.
- **Signal:** the audio is a constant 220 Hz at −3 dBFS in every window checked. It's attributed with sources to the emulator HAL's built-in-mic tone fallback (AOSP goldfish `device_port_source.cpp`, plus the live HAL log), and the host mic was off.
- **Cross-app:** frames at 152, 177, 198, 219 and 226 s show Pocket QA, Settings, Display, Clock and the notification shade.
- **Upload:** only through the explicit "Upload kept items", to the **local** API.
- **What it is not:** a synthetic tone, not a human voice. Real narration on a phone stays a device gate.

**iPhone Stop through the picker** (`stopRecording` → `showBroadcastPicker('')`):
- It's safe by design: the empty tag replaces the pending one, and the extension refuses an empty or untagged broadcast (`consumeTag` requires a non-empty tag), so the picker can't start a recording.
- `isRecording` is re-read on `active`.
- Device-gated.

**P1, a known release blocker** (the lead is fixing it; I'm recording it):
- **The failure:** the rotation run produced video 391.7 s and AAC 202.7 s, with the audio stalling under load (`AudioRecord reported overrun`). The app **didn't detect it**, so the clip would be offered as narrated evidence with half its voice missing.
- **That's an evidence-integrity defect.**
- **What the fix must do:**
  - After finalising, compare `MediaExtractor` per-track durations. If |audio − video| > max(1 s, 2 %), mark the clip "voice incomplete", visible to the tester, with reason copy. It must **not** be uploadable as narrated evidence; the tester can review or discard it.
  - The same check on iOS (`AVAsset` track durations) for parity.
  - A RED→GREEN test, including a test on the **preserved failure clip** (sha256 `f221c20c…cbccd`) or an equivalent synthetic truncated MP4.
- **Before freeze:** rerun rotation, lock, call and death, with per-stream durations and windowed RMS for **every** clip.

**`voice-lifecycle.sh` gaps** (needed for my frozen QA):
- **Activity destroyed while away (P2-A):** add a scenario with `settings put global always_finish_activities 1`: start, Home, use Settings, return, clip present. Reset the setting afterwards.
- **Mic taken away:** add `adb shell appops set com.reshareai.pocketqa RECORD_AUDIO ignore` mid-recording. That exercises the silenced → `mic` reason path. Note that `pm revoke` **kills the process**, so that's the death path instead.
- **Death:** after `force-stop`, besides "no clip", assert the honest "interrupted, couldn't be saved" message (P3-4).
