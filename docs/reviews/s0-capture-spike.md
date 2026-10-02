# S0 capture feasibility: EMULATOR ONLY (real-device gate still blocked)

**Status: not passed on real hardware.** No physical Android phone or Seeker was attached (`adb devices -l` lists only `emulator-5554`). Everything below was observed on the Android emulator. It is evidence for the code path, not for real devices, wallets, or OEM builds.

| Item | Value |
|---|---|
| Device | Android emulator `Medium_Phone_API_36.1`: `sdk_gphone64_arm64`, Android 16 (API 36), google_apis_playstore image |
| App | Pocket QA release APK, `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, sha256 `1c941c781e9e4fa529c46f2b2ca7b47dec5d48eb2d1a170a3da4ea7a67c0b02b` (final, run `20261003-012751`) |
| Recorder | `modules/screen-capture` (MediaProjection + foreground service, ADR 0003) |
| Date | 2026-10-02/03 |

## Observed behavior

| Scenario | Observed on emulator | Evidence |
|---|---|---|
| Consent dialog | System dialog "Share your screen with Pocket QA?". The default is "Share one app"; the user can switch to "Share entire screen" and confirm with "Share screen". It appears **on every start**. | `gate-b-emulator/record-consent--os-consent-dialog.png`, `--os-consent-entire-screen.png` |
| Decline | "Cancel" leads to the app showing "Recording permission was declined. Nothing was recorded." No service and no file are created. | `record-decline--consent-declined.png` |
| Recording | Foreground service `types=0x00000020` (mediaProjection). Ongoing notification "Pocket QA is recording your screen". Red status-bar chip with a timer. `dumpsys media_projection` shows `TYPE_SCREEN_CAPTURE` for our package. | `record-consent--recording-in-progress.png`; `dumpsys` output in `docs/verification.md` |
| Clip | H.264 MP4 at 576×1280 virtual display. Example: 1,361,076 bytes, 5,716 ms. `file` reports "ISO Media, MP4 v2". The server sniffed `video/mp4`. | `record-consent--clip-not-reviewed.png`, `--clip-uploaded.png` |
| Remove before upload | The clip is removed and never uploaded ("No evidence uploaded yet"). | `remove-segment--clip-removed.png` |
| Status-bar stop | Tapping the chip shows "Stop sharing screen?"; "Stop sharing" ends the projection. `onStop` finalizes the clip, and the app shows "Recording stopped… Your clip so far is below for review". | `system-stop--status-bar-stop-dialog.png`, `--system-stopped-clip-kept.png` |
| Notification Stop action | Swiping down shows "Pocket QA is recording your screen" with a **Stop recording** action. Tapping it ends the projection (0 active), removes the notification, and leaves the clip in the review queue. This is the only stop control on Android 10–14. | `notification-stop--notification-with-stop-action.png`, `--notification-stopped-clip-kept.png` |
| Notifications denied (Android 13+) | With `POST_NOTIFICATIONS` denied, the OS prompt "Allow Pocket QA to send you notifications?" leads, via "Don't allow", to the app refusing: "Allow notifications… Nothing was recorded." The capture dialog never opens. | `notifications-denied--notifications-permission-prompt.png`, `--notifications-denied.png` |
| Leaving the session screen while recording | Back to Discover: the recording is discarded, and the runner's `dumpsys media_projection` check reports 0 active projections. | `leave-while-recording--left-session-while-recording.png`, `summary.txt` |
| Screen lock | `KEYCODE_SLEEP` turned the capture virtual display **OFF** (logcat: "Changing state of virtual display PocketQaCapture from ON to OFF"), but the projection **stayed active** (`dumpsys media_projection` still listed it). On this image, a lock did **not** auto-stop recording, unlike the Android docs' description for 15 QPR1+. | `docs/verification.md` |
| Secure screens (`FLAG_SECURE`) | **Not tested.** | — |
| Wallet app switch while recording | **Not tested.** With "Share one app", other apps such as a wallet are excluded by design. | — |

## Decision

- The recorder ships for Android 10+ builds, with consent on every session and the review queue.
- Before anyone promises wallet-screen issue reels, the research's real-device gate still has to be met on a Seeker or another Android 14+ phone: wallet switch, secure screens, and lock behavior.
