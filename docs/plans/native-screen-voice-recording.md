# Native screen + voice recording across apps (Android/Seeker first, iPhone): research and plan

**Status:** plan for the build on `feat/native-voice-recording` (from `main` `ae0b501`). Hamza authorised it on 2026-10-05, relayed by the parent.

**Builder:** `pocketqa-lead` (`claude-opus-5-5`). **Independent review:** `pqa-qa`, whose research and threat checklist r1 is in `.worktrees/qa-native-recording/docs/reviews/native-recording/`.

**Out of scope:** camera, AI, console capture, any DRM or `FLAG_SECURE` bypass, invisible recording, automatic upload, cloud writes, real money.

## Goal
A tester starts recording **in Pocket QA**, switches to the app under test, and narrates. The recording continues across apps, with a visible system indicator and a Stop control. Back in Pocket QA they **review, keep or discard** the clip. Upload happens only through the existing explicit "Upload kept items" path. The clip must contain the **screen and the tester's microphone voice**.

## Sources (primary; checked 2026-10-05)
- **[A1] Android "Media projection"**, https://developer.android.com/media/grow/media-projection:
  - "Your app must request user consent before each media projection session … A MediaProjection token must be used only once";
  - on Android 14+, `createVirtualDisplay()` throws a `SecurityException` if the Intent is reused or the display is created twice;
  - register `MediaProjection.Callback.onStop()` and release resources;
  - Android 15 QPR1+ shows a status-bar chip, and projection "automatically stops when the device screen is locked";
  - Android 14 **app screen sharing** lets the user share a single app; it "excludes the status bar, navigation bar, notifications".
- **[A2] Android "Foreground service types"**, https://developer.android.com/develop/background-work/services/fgs/service-types:
  - `mediaProjection` needs `FOREGROUND_SERVICE_MEDIA_PROJECTION` and is started after `createScreenCaptureIntent()` consent, then `getMediaProjection()`;
  - `microphone` needs `FOREGROUND_SERVICE_MICROPHONE` and the `RECORD_AUDIO` runtime permission;
  - "You cannot create a microphone foreground service while your app is in the background";
  - several types can be declared with a pipe: `mediaProjection|microphone`.
- **[A3] Android "Restrictions on starting foreground services that need while-in-use permissions"**, https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start: on Android 14+, a camera, location or microphone foreground service created from the background throws a `SecurityException`.
- **[I1] Apple `RPSystemBroadcastPickerView`**, https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview:
  - "When a user taps the broadcast button, it displays a broadcast picker";
  - `preferredExtension` limits it to our extension;
  - `showsMicrophoneButton` (default true) shows the system mic toggle;
  - iOS 12+.
- **[I2] Apple `RPBroadcastSampleHandler`**, https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler:
  - set `RPBroadcastProcessMode` to `RPBroadcastProcessModeSampleBuffer` in the extension Info.plist;
  - implement `processSampleBuffer(_:with:)` for video and audio, plus `broadcastStarted`/`Finished`/`Paused`/`Resumed`;
  - ReplayKit calls these serially.
- **[I3] Apple `RPSampleBufferType`**, https://developer.apple.com/documentation/replaykit/rpsamplebuffertype: `video`, `audioApp`, `audioMic`.
- **[I4] Apple App Groups** (the `com.apple.security.application-groups` entitlement) share a container between the app and its extension. A Broadcast Upload Extension runs in its own process with a tight memory budget, so frames stream straight to disk through `AVAssetWriter` and are never buffered.

## Repo facts (base `ae0b501`)
- **Android today:**
  - `modules/screen-capture` (Kotlin): MediaProjection plus a foreground service of type `mediaProjection` only;
  - `MediaRecorder` with SURFACE video and **no audio**;
  - a per-session consent intent; a notification with a Stop action; `Callback.onStop` keeps the clip;
  - `OnCreate` sweeps **every** non-active file, including finished, unreviewed ones;
  - evidence page E2E with Maestro on the emulator (`apps/mobile/e2e/maestro`).
- **iOS today:** no recorder. The study and session screens say recording "isn't supported on iOS in this version".
- **Web:** the desktop recorder exists (`WebRecorderCard`). Mobile browsers get "computer only" copy.

## Design: Android / Seeker
1. **Order.** Consent copy and Start in the session screen, then:
   1. the notifications permission on 13+ (existing);
   2. **`RECORD_AUDIO`**, asked while in the foreground. If it's denied, the tester sees a visible error: **nothing is recorded, and there is no video-only fallback**;
   3. a fresh `createScreenCaptureIntent()`. Android 14+ offers "Share one app" (recommended in our copy: the app under test) or the entire screen;
   4. `startForegroundService`, with `startForeground(…, MEDIA_PROJECTION | MICROPHONE)` **before** `getMediaProjection()`. The app is in the foreground at this moment, as [A3] requires.
2. **Recorder.** `MediaRecorder` with `AudioSource.MIC` (AAC 44.1 kHz mono, 128 kbps) and `VideoSource.SURFACE` (H.264, at most 1280 px on the long edge, 30 fps, 4 Mbps), muxed into one MP4 in app-private `cacheDir/recordings`.
   - Caps: `setMaxDuration(15 min)` and `setMaxFileSize(500 MB)`. On either, the recording stops and the clip is kept.
3. **Across apps.** The foreground service carries capture while the tester uses other apps. Its ongoing notification reads "Pocket QA is recording your screen and microphone" and has a **Stop** action. Android 15+ adds the system chip.
4. **Stop paths.** All of these finalise exactly once, keep a playable clip, and record why:
   - in-app Stop;
   - the notification's Stop;
   - the system chip or screen lock (`Callback.onStop`, reason `system`);
   - **microphone loss**: the recorder's `activeRecordingConfiguration.isClientSilenced` is polled each second, for example during a phone call (reason `mic`);
   - a `MediaRecorder` error (`error`);
   - a cap (`limit`);
   - the service being destroyed.
5. **Persistence.** On finalisation the service writes `<id>.json` next to the MP4: `{complete, durationMs, reason, tag, createdAt}`, where the tag is the participation id.
   - JS claims clips with `takePendingAsync(tag)` when the session screen mounts and after any stop event. Claiming removes the JSON, so JS owns the file.
   - A reload or return to the app therefore never loses a finished clip.
   - An MP4 **without** its JSON is either truncated by process death or orphaned by JS: it's deleted on the next module create and never offered or uploaded.
   - Finished clips nobody claims expire after 24 h.
6. **Rotation:** the virtual display is fixed-size and mirrored, so a rotated screen is letterboxed and recording continues.
7. **Protected content:** `FLAG_SECURE` windows and DRM content stay black, as the OS renders them; nothing works around that. Wallet screens: the copy asks testers not to record wallet or secret screens.

## Design: iOS (capturing OTHER apps)
1. **App side.** An Expo module `PocketQaScreenCapture` (Swift) exposes the following, with **no in-app `RPScreenRecorder`** (that captures only our own app):
   - `showBroadcastPicker()`: an `RPSystemBroadcastPickerView` with `preferredExtension` set to `<app>.Broadcast` and `showsMicrophoneButton = true`, triggered by the tester's tap;
   - `broadcastState()` and `takePendingAsync(tag)`;
   - Darwin notifications from the extension to signal started and finished.
2. **Extension** `PocketQaBroadcast`: a Broadcast Upload Extension with an `RPBroadcastSampleHandler` subclass.
   - `AVAssetWriter` writes H.264 video plus AAC from **`.audioMic` only** into the App Group container's `recordings/<id>.mp4`. App audio is ignored.
   - It writes the same `<id>.json` on finish.
   - **If no mic buffer arrives within the first seconds**, the tester left the picker's Microphone off. The extension then calls `finishBroadcastWithError` with "Turn on Microphone in the picker and start again", and deletes the partial file. There is no silent video-only clip.
   - No network code in the extension.
3. **Handoff.** On return, the app lists finished drafts in the App Group container, moves them into its own cache for review, then keep, discard and explicit upload work as on Android.
4. **Reproducible project:** a config plugin, `apps/mobile/plugins/withBroadcastExtension.js`, adds:
   - the extension target, Info.plist (`NSExtensionPointIdentifier com.apple.broadcast-services-upload`, `RPBroadcastProcessMode`) and sources;
   - the App Group entitlement on both targets.
   
   `expo prebuild` regenerates it.
5. **Hard gates, stated plainly:**
   - system broadcast doesn't run in the iOS Simulator;
   - a physical iPhone and a team with an App Group-enabled provisioning profile are needed to run it.
   
   Here we prove that `xcodebuild` builds the app plus the extension for the simulator, and unit-test what we can.

## Mobile web
Mobile browsers can't capture other apps; a PWA can't either. The copy says so and points to two options:
- installing the app: the Android app records other apps with narration; on iPhone, the Pocket QA app uses a system broadcast;
- recording with the phone's own screen recorder, then importing the file with "Attach screenshot or clip".

## Test plan (strict red, then green; no real content)
- **Kotlin JVM unit tests:** `PendingStore` (complete, claim, truncated sweep, expiry) and the capture-size and reason mapping.
- **Jest:**
  - the session screen asks for the microphone before Start;
  - a denied mic means a visible error and no `startAsync`;
  - pending clips are claimed on mount and after stop events, de-duplicated;
  - the stop-reason copy;
  - the iOS picker path;
  - the mobile web copy.
- **Android emulator** (our own read-only AVD instance with audio and gRPC; never QA's `emulator-5554`; synthetic content only, meaning emulator system apps and a gRPC-injected **sine tone** as the microphone):
  1. Release APK; Maestro: sign in, open a session, Start, mic plus screen consent ("Share entire screen").
  2. Switch to Settings, then Clock or Calculator, using a synthetic emulator image with no user data.
  3. Stop from the notification, return, review, keep, and upload through the existing authorised path to the **local** API.
  4. ffprobe the uploaded file: one H.264 and one AAC stream, with frames extracted at timestamps showing the other apps. Audio volumedetect must be **non-silent** (the injected tone).
  5. Also: the mic-denied flow (Maestro denies `RECORD_AUDIO`), screen lock, the chip/system stop, rotation during recording, and process death (`am kill` / `force-stop`, then the truncated file is swept).
- **iOS:**
  - `expo prebuild --platform ios`, then `xcodebuild -sdk iphonesimulator` builds both targets;
  - the simulator app shows the picker entry and honest copy;
  - **physical-device steps are documented, not claimed.**
