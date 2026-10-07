# Device test handoff: native screen + voice recording (Android / Seeker over USB)

**This is experimental device testing, not release approval.**
- The candidate is unmerged. pqa-qa's verdict gates any merge, and nothing has been pushed or deployed.
- Use it on your own phone, with your own consent, recording only synthetic or harmless screens.
- Don't record wallet, password or private screens.

## The build
| | |
|---|---|
| APK | `/Users/hamzadiaz/Projects/pocket-qa/.worktrees/native-voice/dist-native/pocketqa-native-0aaa89b.apk` |
| sha256 | `6bd0d35afc7017ceef1a948af42c00f869cc59264889ab44d1a44769624095b9` |
| Size | 52,483,477 bytes |
| Code | `feat/native-voice-recording` @ `0aaa89b`: the new capture pipeline, merged with main `daf0c85` (intro, badges) |
| Package | `com.reshareai.pocketqa` 0.1.0 (1); release variant with an embedded JS bundle, signed with the **Android debug key** (sideload only, not Play-signable) |
| Devices | arm64-v8a only; installs on Android 7+ (minSdk 24); **recording needs Android 10+**; target SDK 36 |
| API it calls | `http://127.0.0.1:8787` (the loopback default; `EXPO_PUBLIC_API_URL` was not set). It doesn't use the password-gated public preview. |

## Backend (on this Mac)
- An **isolated local API** with synthetic data runs on `127.0.0.1:8787`; check it with `curl -s http://127.0.0.1:8787/health`.
- Uploads land only in its local media directory, never on R2 or any cloud.
- The phone reaches it over USB through `adb reverse`.
- The test tester's email, password and study name are in a **private file** (mode 600) that the lead names in chat. They are never printed in logs, chat or the repo.

## Install over USB
1. On the phone, enable Developer options › USB debugging, connect the cable and accept the computer's key.
2. Install and connect the port, using the serial from `adb devices` (not the emulator):
   ```
   adb devices
   adb -s <serial> install -r /Users/hamzadiaz/Projects/pocket-qa/.worktrees/native-voice/dist-native/pocketqa-native-0aaa89b.apk
   adb -s <serial> reverse tcp:8787 tcp:8787
   ```
   Re-run `adb reverse` after every reconnect.
3. To check the file first: `shasum -a 256 <apk>` must print the sha256 above.

## What to test (about 15 minutes)
1. Open Pocket QA. The intro appears once on a fresh install; Skip it, or swipe through. Sign in with the test tester.
2. Open the test study, consent, and tap **Start session**.
3. Tap **Record screen and voice**. Allow notifications and the **microphone**, then on "Share your screen with Pocket QA?" choose **Share one app** and a harmless app (Settings, Clock or Calculator), or the entire screen.
4. **Speak** while you use that app for **at least 10 minutes**; this is the gate that has never been run. Also try:
   - rotating the phone;
   - locking it for a few seconds (Android 15 QPR1+ may stop the recording; the clip should still come back);
   - receiving a call (the recording should stop by itself with "Your microphone stopped…").
5. Stop from the **notification** (or the red status chip, or in Pocket QA). Come back to Pocket QA: the clip is listed for review. Play it and check your voice is audible throughout.
   - If it says "Voice stops at…" or "Parts of your voice are missing…", the app caught a gap: please report it.
6. Tap **Keep**, then **Upload kept items**.
7. Optional extras:
   - with the microphone permission turned off in Settings mid-recording, the app should stop and say so;
   - "Don't record" in the consent dialog should leave nothing recorded.

## What to send back (no recording content needed)
- Phone model and Android version. If it's a **Seeker**, say so: Seeker behaviour hasn't been seen before.
- What you saw at each step, and any notice text.
- The pipeline's one-line evidence, which contains no content:
  ```
  adb -s <serial> logcat -d | grep PqaCapture
  ```
  It reports `audioGaps`, `audioLostMs`, `backlogDropped` and the samples written.
- The lead can then run the evidence gate on the uploaded file, with the **signal check on** (not `--structure-only`): `apps/mobile/e2e/maestro/check-voice.py <file>`.
  - The file is in the local API's media dir; it is your real voice, so it stays private and is deleted after.

## Not covered by this handoff
- **iPhone:** not installable yet. This is an **explicit gate**: an Apple Developer team; App IDs `com.reshareai.pocketqa` and `com.reshareai.pocketqa.Broadcast`, with App Group `group.com.reshareai.pocketqa` on both; profiles; a signed build. The Simulator compile succeeds, but a system broadcast can't run there.
- **Untethered use** (no cable): needs an approved https backend; the cookie-gated preview can't serve the native app.
- **Release:** merge waits for pqa-qa's verdict and the device results above. Emulator evidence is structure-only (its microphone is near-silent), so real speech is exactly what this test adds.
