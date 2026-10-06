# P-13 (P1): the app crashes when the tester shares "A single app" (Android 14+, physical Seeker)

| Field | Value |
|---|---|
| Found by | pqa-ios, full E2E physical lane, 2026-10-06 |
| Environment | physical-android: Solana Seeker (`SM02E4072811963`, product `seeker_eea`), Android 16 / API 36 |
| App build | E2E APK built from **7bda3ce** (feat/firebase-vercel, live as `dpl_DfajPV9SaXdbJ8TrCdujU5kr1bvi`). Only the applicationId (`com.reshareai.pocketqa.e2e`) and app label differ from the candidate. sha256 `39cf3194c01757c7c4482b0919e35453837341335e26c91efae1b8ab97e10cb3`, debug-signed |
| Account | the verified synthetic tester "QA synthetic tester (hosted)"; study `i4bbaf30706c493edcacc8c3ec61a5af` |
| Severity | **P1**: on Android 14+, "A single app" is the option the copy recommends for privacy, and choosing it crashes the app every time. Nothing is recorded; the tester sees "Application Error". |

## Repro
1. Have Pocket QA with RECORD_AUDIO and POST_NOTIFICATIONS granted, signed in as a tester and in an in-progress session.
2. Tap **Record screen and voice**.
3. In "Share your screen with Pocket QA …?", choose **A single app**, then pick any app (here Chrome).

## Expected
Recording starts on the chosen app, with microphone narration. Or, if the platform can't allow it, Pocket QA refuses cleanly and says why. It never crashes.

## Observed (device logcat, local time 23:24, UTC+2)
Excerpts are in `evidence/pqa-ios/physical/p13-sequence-logcat.txt` and the full stack in `p13-crash-androidruntime.txt`.

| Time | Event |
|---|---|
| 49.96 | notifications granted |
| 51.36 | microphone granted |
| 51.43 | `MediaProjectionPermissionActivity` displayed |
| 54.43 | `MediaProjectionAppSelectorActivity` ("A single app") |
| 58.175 | `START … com.android.chrome …` (the chosen app is moved to the foreground by the system) |
| 59.40 | `FATAL`, then `Force finishing activity com.reshareai.pocketqa.e2e/…MainActivity`, then the "Application Error" window |

The exception:

```
java.lang.RuntimeException: Unable to start service expo.modules.pocketqascreencapture.ScreenCaptureService … java.lang.SecurityException: Starting FGS with type microphone … targetSDK=36 requires permissions: all of [FOREGROUND_SERVICE_MICROPHONE] any of [… RECORD_AUDIO] and the app must be in the eligible state/exemptions to access the foreground only permission
  at ScreenCaptureService.startForegroundCompat(ScreenCaptureService.kt:230)
  at ScreenCaptureService.start(ScreenCaptureService.kt:86)
  at ScreenCaptureService.onStartCommand(ScreenCaptureService.kt:63)
```

## Cause
- The module starts the service only from the projection result: `ScreenCaptureModule.kt:82-96`, `OnActivityResult` → `startForegroundService`.
- The service then calls `startForeground(…, MEDIA_PROJECTION | MICROPHONE)` (`ScreenCaptureService.kt:230`).
- With single-app sharing, Android puts the chosen app in front **before** delivering the result. Pocket QA is therefore in the background, and a microphone foreground service is while-in-use only: Android refuses to start it from the background.
- The emulator runs chose "Entire screen", where Pocket QA stays in front, so they never hit this.
- RECORD_AUDIO itself was granted (dumpsys: `granted=true, USER_SET`).

## Fix direction (owner pqa-ios, after the device run, test first, branch from feat/firebase-vercel)
- Start the foreground service with type **MICROPHONE** while Pocket QA is still in the foreground, **before** launching the projection consent.
- After consent, add **MEDIA_PROJECTION** to the running service.
- If any start or upgrade fails, refuse cleanly (no projection kept, honest message) and never crash.
- Re-verify on the Seeker with "A single app".

## Not affected / still to verify
"Entire screen" path: being re-run on the device (P-14+).
