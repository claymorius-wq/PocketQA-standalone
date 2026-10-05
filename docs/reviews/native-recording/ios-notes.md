# pqa-ios: iPhone screen + voice recording (Broadcast Upload Extension), implementer notes

**Branch:** `feat/native-voice-ios` (from `c648dd2`). **Owner:** pqa-ios. **Evidence:** `ios-build.txt` (next to this file).

**Honest scope.**
- **Proven:** `expo prebuild --platform ios` reproducibly adds the extension target. `pod install` succeeds, and `xcodebuild` (simulator, `CODE_SIGNING_ALLOWED=NO`) builds the app **and** `PocketQaBroadcast.appex`, embedded in `PocketQA.app/PlugIns`. The jest plugin tests and the Swift handoff unit tests pass.
- **Not proven:** that a broadcast actually records. System broadcast **does not run in the iOS Simulator**.
- **Real-device gate:**
  - a physical iPhone;
  - a team whose provisioning profiles include the App Group `group.com.reshareai.pocketqa` for **both** `com.reshareai.pocketqa` and `com.reshareai.pocketqa.Broadcast`.

  No iPhone was touched, and no signing, provisioning or Apple account was changed. No "iPhone verified" claim is made (N11).

## Files
| Path | What |
|---|---|
| `modules/screen-capture/ios/ScreenCaptureModule.swift` | Expo module `PocketQaScreenCapture` (app side) |
| `modules/screen-capture/ios/BroadcastShared.swift` | Foundation-only, compiled into **both** the pod and the extension:<br>• PendingStore port (same contract as Android after pqa-qa r1): `<id>.mp4`, `<id>.rec` (tag at start), `<id>.meta` (JSON: durationMs, tag, reason, createdAt, videoMs, voiceMs, voiceComplete), `<id>.lost`; write-then-rename; directory excluded from backups<br>• `VoiceCheck` + `Mp4Tracks` (voice must cover video within max(1 s, 2 %))<br>• `BroadcastState` (App Group UserDefaults)<br>• `MicWatch`, `captureSize`<br>• Darwin notify helpers |
| `modules/screen-capture/ios/Tests/main.swift` (+ `Tests/voice/*.mp4`) | macOS `swiftc` harness, 27 tests (mirrors Android `PendingStoreTest` and `VoiceCheckTest`). Fixtures: the lead's synthetic ffmpeg MP4s plus Apple-muxed copies (`avconvert --preset PresetPassthrough`). The parser is cross-checked against AVFoundation. Not part of the pod |
| `modules/screen-capture/ios/PocketQaScreenCapture.podspec` | `source_files = '*.swift'`, ReplayKit |
| `modules/screen-capture/ios-extension/SampleHandler.swift` | `RPBroadcastSampleHandler`, `AVAssetWriter` H.264 + AAC from `.audioMic` only |
| `modules/screen-capture/ios-extension/Info.plist` | `com.apple.broadcast-services-upload`, `RPBroadcastProcessModeSampleBuffer`, `$(PRODUCT_MODULE_NAME).SampleHandler` |
| `modules/screen-capture/ios-extension/PocketQaBroadcast.entitlements` | App Group only |
| `modules/screen-capture/expo-module.config.json` | Adds `apple` → `ScreenCaptureModule` |
| `apps/mobile/plugins/withBroadcastExtension.js` | Config plugin. Tested by `apps/mobile/__tests__/broadcast-extension-plugin.test.ts` (fixture: the unmodified prebuild pbxproj) |
| `apps/mobile/app.json` | The plugin, plus `ios.entitlements` App Group (the single source; the plugin fails prebuild if the extension's group differs) |

## Contract mapping (`apps/mobile/src/evidence/recorder.ts`)
- **`showBroadcastPicker(tag)`**
  1. Writes `pendingTag` and a timestamp to the App Group defaults.
  2. On main, creates `RPSystemBroadcastPickerView` with `preferredExtension` = Info.plist `PocketQaBroadcastExtension` (`com.reshareai.pocketqa.Broadcast`) and `showsMicrophoneButton = true`.
  3. Forwards the tester's tap to the picker's internal button.

  The tester still taps **Start Broadcast** in the system sheet. There is no public "present" API, so the forwarded tap is the widely used workaround and needs device confirmation on current iOS.
- **`takePendingAsync(tag)`**: that tag's finalised clips, **listed in place** in `<group>/recordings` until JS deletes the file (after upload or discard), so a remount or a process restart loses nothing (pqa-qa r1 P2-A). An empty tag lists nothing.
  - Each clip is `{uri: file://…, durationMs, sizeBytes, mimeType: 'video/mp4', videoMs, voiceMs, voiceComplete}`.
  - expo-file-system scopes App Group directories as read/write, so JS reads, uploads and deletes the file where it is.
- **`takeInterruptedAsync(tag)`**: sweeps first, because the extension can die while the app lives (a live file is protected by the heartbeat). It then returns how many of that session's recordings were cut off, each counted once (`.lost` notices, 24 h).
- **`clearAllAsync()`** (sign-out, account deletion): discards a live broadcast (Darwin discard, waits up to 3 s), forgets any pending session tag, and deletes every clip, meta and notice in the group directory.
- **`isRecording()`**: the extension's active file **with a heartbeat under 10 s old**, so a killed extension never looks live.
- **`onStopped`**: one event per finished broadcast, keyed by a stop sequence number. It fires from the extension's Darwin notification, or on `didBecomeActive` if the notification landed while the app was suspended. **`clip` is always `null` on iOS.** The clip arrives through `takePendingAsync`, which the screen already calls in the handler and on every return to the front. This guarantees the clip only reaches the session whose tag it carries.
- **`stopAsync` / `startAsync`**: reject `ERR_UNSUPPORTED`. On iOS only the system stops a broadcast (red status pill or Control Centre).
- **`discardAsync`**: if a broadcast is live, posts a Darwin "discard". The extension cancels the writer, deletes the file and ends the broadcast with "Recording discarded: you left the Pocket QA test session." The call waits up to 3 s.
- **`purgeAsync`**: sweeps the group dir (truncated, orphaned or expired files; the live file is protected). Finished clips stay for their session.
- **Module creation**: sweeps once and removes the d0a857b-era `Caches/pocketqa-recordings`. Stops from before the process started are not replayed as events, but their clips stay listed for 24 h.

## Extension behaviour (checklist ties)
- **N1, no silent start.**
  - The extension **consumes** a session tag that the app set within the last 5 minutes. Without one, for example a broadcast started from Control Centre, it refuses with "Start screen broadcasts from a test session in Pocket QA" and records nothing.
  - The tag is single-use.
- **N3, no silent video-only clips (`MicWatch`).**
  - If no non-zero `.audioMic` sample arrives within 3 s, the broadcast is refused with "Turn on Microphone in the broadcast picker and start again…" and the partial file is deleted.
  - All-zero buffers count as no microphone, because ReplayKit documents silent buffers when the mic isn't capturing.
  - If narration was heard and then nothing is heard for 5 s (for example a call took the mic), the broadcast ends with reason `mic`. The clip so far is kept, like Android's silenced-mic stop.
  - A broadcast pause restarts the clock.
  - **These thresholds are design values and need device tuning.**
- **Audio sources:** `.audioApp` is ignored (only narration is recorded). The extension has no network code and no camera; the jest test guards against `URLSession`, `NWConnection`, `Network`, sockets and `AVCaptureDevice`.
- **Memory:** `AVAssetWriter` streams to disk in real time, and frames are never held beyond the callback. The writer is created on the first video frame:
  - size: long edge capped at 1920, even dimensions (Android `CaptureMath`);
  - video: H.264 High at 4 Mbps;
  - audio: AAC mono, 44.1 kHz, 128 kbps.
- **Caps:** 15 minutes or 500 MB end the broadcast with reason `limit`, and the clip is kept. The extension can only end itself through `finishBroadcastWithError`, so the system shows the message as an error alert ("…Open Pocket QA to review your clip").
- **Finalisation:** `broadcastFinished` (the user stop) blocks on `finishWriting`, then measures the finished file (`VoiceCheck`), writes the meta and only then clears the active state.
  - A file that can't be finalised or read is deleted and reported as reason `error`.
  - A clip whose voice stops early is kept with `voiceComplete: false`.
  - Truncated files (the extension was killed) have no meta. The app sweeps them and leaves a `.lost` notice for `takeInterruptedAsync`.
- **Voice measurement (P1):** track lengths come from the file's own index. The extension uses each track's **presented** duration (`tkhd` in the `mvhd` timescale), because AVAssetWriter uses edit lists: `mdhd` reads 6.2 s video and 6.023 s audio for a 6.0 s Apple-muxed clip, while AVFoundation and ffprobe say 6.0 s. It falls back to `mdhd` only without a usable `tkhd`. Android's parser uses `mdhd`, which is right for MediaRecorder files, but the lead may want the same rule.
- **Heartbeat:** the 0.5 s watchdog timer beats it, not the sample buffers. No buffers flow while a broadcast is paused, and a stale heartbeat would let a sweep take the live file for a truncated one.

## Deviations / decisions for the lead
1. **No-microphone refusal is reported as `reason: 'error'`, `clip: null`.**
   - The screen's existing copy then says "Recording failed. Nothing was recorded." The system alert carries the specific "Turn on Microphone" text.
   - If you want that text in-app too, it needs a new reason or a JS-side message; that's your file, so I haven't touched it.
2. **`reason: 'system'` is never produced on iOS.** ReplayKit gives the extension no signal that distinguishes a system stop from the user's.
3. **JS `recording` state on iPhone.** After `showBroadcastPicker`, the screen never sets `recording = true`, so no in-app "recording" banner appears on return (N2).
   - `isRecording()` is accurate (heartbeat).
   - Suggestion for your screen: re-read `recorder.isRecording()` on `AppState` `active`.
   - I added no event for "started" because the contract has only `onStopped`.
4. **Orientation:** the `RPVideoSampleOrientationKey` attachment isn't applied. Landscape apps record in the buffer's native orientation. This is a device-gated follow-up.
5. **Unmount discard shows a system alert.** The extension's only way to end itself is `finishBroadcastWithError`, so the discard path shows "Recording discarded…". This is intentional, since the tester should know capture stopped.

## How to re-run
```
export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH
swiftc -o /tmp/pqa-broadcast-tests modules/screen-capture/ios/BroadcastShared.swift modules/screen-capture/ios/Tests/main.swift && /tmp/pqa-broadcast-tests
(cd apps/mobile && npx jest __tests__/broadcast-extension-plugin.test.ts)
(cd apps/mobile && rm -rf ios && CI=1 npx expo prebuild --platform ios --no-install && cd ios && pod install)
(cd apps/mobile/ios && xcodebuild -jobs 4 -workspace PocketQA.xcworkspace -scheme PocketQA -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build)
```
Heavy steps (pod install, xcodebuild) are serialised with the lead's emulator runs; use `-jobs 4`.
