# Native screen + voice recording: installing a test build and pointing it at a backend

Scope: the local test build on `feat/native-voice-recording` (plan: `docs/plans/native-screen-voice-recording.md`).
It is **not** a store build. No store upload, no deployment, no cloud writes are part of this.

## What the builds are
| Platform | Artifact | Signed with | Runs where |
|---|---|---|---|
| Android / Seeker | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (release variant, arm64-v8a) | the Android **debug** keystore (Expo prebuild default) | any arm64 Android 10+ phone or the arm64 emulator, by sideload |
| iPhone | `PocketQa.app` with `PlugIns/PocketQaBroadcast.appex`, iphonesimulator, `CODE_SIGNING_ALLOWED=NO` | unsigned | **Simulator only**; see "iPhone gate" |

The release variant is used because it embeds the JS bundle (no Metro needed); it is still a test build (debug keystore, not Play-signable).

## Backend: which API the app talks to
The API address is fixed **at build time** by `EXPO_PUBLIC_API_URL` (`apps/mobile/src/api/client.ts`); without it the app uses `http://127.0.0.1:8787`.
Cleartext HTTP is allowed **only to loopback** (`apps/mobile/plugins/withLocalhostCleartext.js`); every other host must be https.

### Option A (works today): phone on USB, local API on the dev machine
1. Start the local API with isolated, synthetic data (never a production data dir):
   ```
   mkdir -p <scratch>/api-data && chmod 700 <scratch>/api-data
   POCKETQA_DATA_DIR=<scratch>/api-data POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local pnpm --filter @pocket-qa/api start
   curl -s http://127.0.0.1:8787/health
   ```
2. Seed a tester and a study: `node apps/mobile/e2e/maestro/seed.mjs` prints `EMAIL`, `PASSWORD`, `STUDY` (synthetic). Don't paste the password into tickets or logs.
3. Connect the phone with USB debugging on, then:
   ```
   adb devices                       # note the serial
   adb -s <serial> install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
   adb -s <serial> reverse tcp:8787 tcp:8787
   ```
   `adb reverse` makes `127.0.0.1:8787` on the phone reach the dev machine, so the default build needs no other configuration. Re-run `adb reverse` after every reconnect.
4. Uploaded clips land in `<scratch>/api-data/media/` on the dev machine (local storage only; nothing goes to R2).

### Option B (gate, not available yet): phone without a cable
Needs an **https** API on a public host, built in with `EXPO_PUBLIC_API_URL=https://… EXPO_PUBLIC_POCKETQA_ENV=production` (the build refuses http/private hosts: `apps/mobile/src/lib/deployment.ts`).
The password-gated preview at `pocketqa.optijara.ai` is **not** usable for this: its gate is a browser cookie, and the native app sends bearer tokens only. Pointing a native build at a hosted API needs a separately approved backend (`docs/deploy/cloud-backend.md`); it is not part of this build.

## Recording on the phone (what a tester sees)
1. Sign in, open the study, consent, **Start session**.
2. **Record screen and voice**: Android asks for notifications (13+), then the **microphone**, then "Share your screen with Pocket QA?": choose **Share one app** and the app under test (or the entire screen).
   Refusing the microphone shows "…needs the microphone… Nothing was recorded." and no screen dialog appears (no video-only clip).
3. Switch to the app under test and narrate. The notification "Pocket QA is recording your screen and microphone" (and, on Android 15+, the red status-bar chip) stays visible; **Stop recording** in the notification ends it from any app.
4. Return to Pocket QA: the clip is listed for review. **Keep** or **Discard**; nothing uploads until **Upload kept items**.
5. If the microphone was cut off during the recording (a call, the system taking it), the clip is listed with "Voice stops at m:ss of m:ss…" and can only be removed: it is never uploaded as narrated evidence.

Protected (`FLAG_SECURE`) and DRM windows record black; that's the OS, by design. Don't record wallet or password screens.

Indicators: on Android 14 and later the user can swipe the recording notification away (Android made all foreground-service notifications dismissible). Recording continues and stays visible through the green microphone/privacy indicator, and on Android 15 QPR1+ the red status-bar chip, which also stops it. Stop is always available in Pocket QA's session screen. Signing out stops any recording and deletes every clip on the phone.

## iPhone gate (stated plainly)
- The system broadcast that records other apps **does not run in the iOS Simulator**. The simulator build proves the app and extension compile, embed and are configured; it cannot record.
- To run on a real iPhone you need: an Apple Developer team; App IDs `com.reshareai.pocketqa` and `com.reshareai.pocketqa.Broadcast`; the App Group `group.com.reshareai.pocketqa` enabled on both; development provisioning profiles for both; then `expo prebuild --platform ios`, `pod install`, and a signed `xcodebuild` (or Xcode) install to the device. None of this exists yet.
- Details and the module/extension design: `docs/reviews/native-recording/ios-notes.md`.

## Seeker gate
No Solana Seeker was connected. The Android build targets standard Android APIs only (MediaProjection, foreground service `mediaProjection|microphone`); no Seeker-specific API or hardware attestation is used or claimed. Seeker behaviour (OEM recording UI, chip, lock behaviour) is unverified until run on the device.
