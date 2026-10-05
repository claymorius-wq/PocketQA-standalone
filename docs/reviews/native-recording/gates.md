# Native screen + voice recording: what is proven, what is blocked (2026-10-05)

Code freeze candidate: `feat/native-voice-recording` @ `c5e629d`. Evidence is **emulator and simulator only**.
**This is not "mobile ready".** Real-phone recording, real speech and the iPhone broadcast are unproven.

## Words used here
- **Synthetic non-silent signal**: on the Android emulator, the microphone delivers the emulator HAL's own 220 Hz tone. The HAL falls back to it when it can't open a host capture source; the host mic was off throughout. Seeing it in a recording proves that the app's **microphone path** is captured live and muxed with the screen for the whole clip. It does **not** prove that speech is captured, intelligible or well levelled: **speech microphone verification** needs a real phone and a person talking.
- **BLOCKED (infra)**: the test harness failed, not the app, and there was one bounded retry (parent's rule, 2026-10-05). It is neither a pass nor a product failure.

## Proven (engineering scope)
| Gate | Evidence |
|---|---|
| Android records the screen and microphone while the tester uses **other apps**, stops from the notification, and returns the clip for review; it uploads only through Keep + Upload (local API) | r3 `voice-cross-app.yaml` rc=0 on APK `07415792…` (= freeze build); frames from the clip show Pocket QA (Stop shown), Settings › Display & touch, the launcher, and the notification shade "Pocket QA is recording your screen and microphone"; `android-r3/` |
| The clip carries the (synthetic) mic signal for its **whole** length | r3: video 276.108 s, audio 275.505 s, \|a−v\| 0.604 s; 56 × 5 s windows from −3.0 to −3.2 dBFS (`android-r3/check-voice-cross-app.txt`). Run 5: 230.366 / 229.645 s, 46 windows (`android-cross-app/probe.txt`) |
| Signal provenance is honest | Live emulator HAL log "failed to create alsa source for 'AUDIO_DEVICE_IN_BUILTIN_MIC'; creating a tone source instead"; AOSP `device_port_source.cpp`; AudioService `src:MIC … pack:com.reshareai.pocketqa … silenced:false` (`android-cross-app/probe.txt`) |
| A refused microphone records nothing (no video-only clip) | `voice-mic-denied.yaml` PASS (APK before the voice-check fix; that JS path is unchanged) |
| **A voice that stops early is caught** (release blocker) | The preserved emulator failure (video 391.7 s, AAC 202.7 s; sha256 `f221c20c…`, kept privately) is detected by `VoiceCheckTest` on the real file; synthetic truncated and no-audio fixtures; the UI says "Voice stops at m:ss of m:ss…" and offers Remove only (jest). Same rule on iOS (pqa-ios swiftc tests) |
| Clips survive the screen being destroyed in the background; only their session lists them; sign-out and account deletion clear them; a recording lost to process death is reported once | Kotlin `PendingStoreTest` 10; jest session 40 and sign-out 1; 13/13 mutants caught |
| iPhone code compiles for the Simulator: app plus the Broadcast Upload Extension, embedded with its App Group | see "iOS compile" below |

## BLOCKED (infra): Android lifecycle scenarios on the emulator
Harness and flows are committed (`apps/mobile/e2e/maestro/voice-lifecycle.sh`, `_voice-*.yaml`, `check-voice.py`). They are ready to run again on healthier infrastructure or a phone.

| Scenario | What happened (r3) |
|---|---|
| rotation | Recording started and survived landscape (projection active). The stop and upload flows failed twice each: "Maestro Android driver did not start up in time". A new Maestro session can't attach while a projection is running on this emulator (also seen in r1). The single-session cross-app flow is unaffected. |
| lock | Start flow: Maestro gRPC `UNAVAILABLE` "Command failed (tcp:…): closed" |
| call, micoff (appops RECORD_AUDIO ignore), dka (always_finish_activities), death | not reached after the above. Run stopped under the bounded-retry rule. |

Earlier, the r1 run observed (manually, through adb) that a recording continued through landscape and back, and that an in-app Stop produced a reviewable clip. Its audio stopped at 202.7 s, which was the blocker now detected. On this emulator image, screen lock does **not** stop projection (also seen 2026-10-03).

## Hardware gates (need a person with the device)
1. **Android phone / Solana Seeker**: install the APK (`docs/handoff/native-recording-device-install.md`, USB + `adb reverse`), record 1–2 minutes across two real apps while **speaking**, then stop from the notification, keep and upload. Verify the speech is audible and the voice check passes. Repeat with rotation, lock (Android 15 QPR1+ stops on lock), an incoming call, and Settings › Apps › Pocket QA › Microphone off mid-recording. **Seeker** has not been connected at all; no Seeker-specific API is used or claimed.
2. **iPhone**: needs an Apple Developer team, App IDs `com.reshareai.pocketqa` and `com.reshareai.pocketqa.Broadcast`, App Group `group.com.reshareai.pocketqa` on both, development profiles, and a signed install. Then: picker → Microphone on → Start Broadcast → other apps while speaking → stop from the status indicator → review in Pocket QA. The Simulator cannot run a system broadcast.
3. **Untethered phone**: needs an approved https backend (`EXPO_PUBLIC_API_URL`); the cookie-gated preview can't serve the native app.

## iOS compile (frozen combined code `c5e629d`; pqa-ios, `ios-build.txt` §12, evidence commit 8ec331e)
- `expo prebuild --platform ios --clean`, then `pod install`, then `xcodebuild -workspace PocketQA.xcworkspace -scheme PocketQA -sdk iphonesimulator -configuration Debug -jobs 4 CODE_SIGNING_ALLOWED=NO build` gave **BUILD SUCCEEDED** with 0 errors. 543 compiler warnings plus 2 script-phase warnings, **all third-party** (React-Core, Pods headers, Expo modules…), **0 in our sources**.
- Lead's independent check of the built bundle:
  - `PocketQA.app` is `com.reshareai.pocketqa`;
  - `PlugIns/PocketQaBroadcast.appex` is `com.reshareai.pocketqa.Broadcast`, with `NSExtensionPointIdentifier` `com.apple.broadcast-services-upload` and `RPBroadcastProcessMode` `RPBroadcastProcessModeSampleBuffer`;
  - archs x86_64 and arm64.
- App Group `group.com.reshareai.pocketqa` is in both generated entitlements files. The build is **unsigned**, so the entitlement is not signed into the binaries.
- Swift handoff and voice-check tests at `c5e629d`: 27, 0 failures (macOS swiftc). Plugin jest 14/14.
- **Not proven:** any broadcast recording. The Simulator can't run a system broadcast. That needs a physical iPhone and a team whose profiles include the App Group for both bundle ids.
