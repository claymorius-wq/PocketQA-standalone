# Native screen + voice recording: what is proven, what is blocked (updated 2026-10-06)

- **Candidate:** `feat/native-voice-recording` code @ `0aaa89b` (= `fe89787` + pqa-qa's P3: the intro's entrances render still off screen); APK sha256 `6bd0d35afc7017ceef1a948af42c00f869cc59264889ab44d1a44769624095b9`. `fe89787` is the native branch with the AudioRecord + MediaCodec + MediaMuxer pipeline (`fdc8e95`, `30a98d9`), the off-screen entrance fix (`44fea59`) and pqa-ios's iOS parity (`267fca4`), merged with `origin/main` `daf0c85` (#10 intro, #11 badges and leaderboard).
- **Evidence:** emulator and compile only. **This is not "mobile ready".** Real-phone recording, real speech, the iPhone broadcast and the Seeker are unproven.
- History: the earlier MediaRecorder candidate (`c5e629d`) is superseded. Its voice stall is analysed in `docs/plans/native-capture-pipeline.md`.

## Words used here
- **Structure only:** the emulator now runs with `-no-audio`, so its microphone delivers **near-silence** (no signal: the clips measure at the codec noise floor, e.g. the control run mean −91 dB, max −71 dB by volumedetect). The gate (`check-voice.py --structure-only`) then proves:
  - one H.264 and one AAC stream;
  - |audio − video| ≤ 1 s;
  - no audio timestamp gaps (the samples held account for the duration within 0.5 s);
  - the pipeline's own `PqaCapture` stop line (gaps, lost ms, dropped chunks).

  It does **not** prove that a signal reached the file.
- **Synthetic non-silent signal:** the emulator HAL's 220 Hz tone. It was seen only with the old MediaRecorder build (run 5, r3), before fresh emulator instances began aborting in host CoreAudio. It is **not speech verification**.
- **BLOCKED (infra/harness):** the test harness or emulator failed, not the app.

## Proven (engineering scope)
| Gate | Evidence |
|---|---|
| Android records the screen and microphone while the tester uses **other apps**; notification Stop; the clip returns for review; upload only through Keep + Upload (local API) | combined build `fe89787`, APK `277e8744…91a9`: `voice-cross-app.yaml` rc=0, **including main's intro** (shown and skipped on a fresh install, not shown again on return); `android-pipeline/combined-cross-app.txt` |
| The audio path stays continuous under the stimuli seen at the old stalls | `android-pipeline/README.md`, "stress": rotation, uiautomator bursts, forced dexopt and lock during one recording; gaps 0, lost 0, overruns 0, 238.188 / 238.121 s |
| Lifecycle | control PASS; call PASS (the system silenced the mic, the app stopped itself, the clip came back and uploaded); dka PASS (the activity was destroyed while away, the recording survived, P2-A); death PASS (the interrupted notice, no clip); `android-pipeline/README.md` |
| A voice that stops early, or is missing in the middle, is caught and can't be uploaded | VoiceCheck (edge max(1 s, 2 %); mid-clip lost > 1 s or a gap > 0.5 s), JVM tests on synthetic and real MP4s, including the preserved failure clip; jest copy and no Keep; `check-voice-selftest.sh` 8/8 (pqa-qa reproduced it with its own gapped fixture) |
| A refused microphone records nothing | `voice-mic-denied.yaml` PASS |
| A clip and stop notice that arrive while the app is off screen are visible on return | the bug found in the call scenario (`call-before-fix-blank.png`), fixed in `44fea59` (`call-clip-visible-after-fix.png`); jest RED → GREEN |
| Sign-out and account deletion clear clips; only the clip's own session lists it | Kotlin PendingStore tests; jest sign-out |
| Workspace | `pnpm verify` EXIT=0 at `fe89787` (mobile 63 suites, 1344 tests); Playwright 28/28 |
| iPhone code compiles: the app plus the Broadcast Upload Extension | see "iOS compile" |

## Not exercised or BLOCKED
| Item | Status |
|---|---|
| A non-silent mic signal through the **new** pipeline | **BLOCKED (infra)** on this emulator. Fresh instances with host audio abort in CoreAudio at the first mic open; `-no-audio` gives silence; the HAL's simulate-input property wasn't applied. It is part of the device gate. |
| Mic loss via `appops RECORD_AUDIO ignore` | **Not exercised**: on this image it didn't silence a capture that was already running. Silencing is covered by the call scenario. |
| Root cause of the old MediaRecorder stall | **Not proven.** It correlated with bursts of system work, and the control run before the switch never executed. The new pipeline is built so that a stall can't pass silently, and the stress run passed. |
| Lock stopping projection (documented for Android 15 QPR1+) | not on this Android 16 emulator image (projection stays live). Handled either way. |

## Hardware gates (need a person with the device)
1. **Android phone and Solana Seeker:** install the APK (`docs/handoff/native-recording-device-install.md`); record **at least 10 minutes** across two real apps while **speaking**; then stop, keep and upload. The speech must be audible, and the clip must pass `check-voice.py` with the signal check on. Repeat with rotation, lock, an incoming call, and the microphone switched off in Settings mid-recording. No Seeker has been connected; no Seeker-specific API is used or claimed.
2. **iPhone:** an Apple Developer team; App IDs `com.reshareai.pocketqa` and `com.reshareai.pocketqa.Broadcast`, with App Group `group.com.reshareai.pocketqa` on both; profiles; a signed install. Then: picker → Microphone on → Start Broadcast → other apps while speaking → stop → review.
3. **Untethered phone:** an approved https backend (`EXPO_PUBLIC_API_URL`).

## iOS compile
- At `c5e629d`: BUILD SUCCEEDED, 0 warnings in our sources (`ios-build.txt` §12).
- At `fe89787` (the combined code; native sources identical at `0aaa89b`): `expo prebuild --platform ios --clean`, `pod install`, `xcodebuild … -sdk iphonesimulator -configuration Debug -jobs 4 CODE_SIGNING_ALLOWED=NO build`.
  - **BUILD SUCCEEDED**, 0 errors. 0 warnings in our sources; 543 + 2 third-party.
  - It compiled the module's `voiceLostMs` change that §13 couldn't typecheck.
  - The appex is embedded (`com.reshareai.pocketqa.Broadcast`, broadcast-services-upload, SampleBuffer, x86_64 and arm64), with the App Group in both generated entitlements. The build is unsigned.
  - 32 swiftc tests, 0 failures. No simulator was booted (§14, evidence `cf7073a`).
- **Not proven:** any broadcast. The Simulator can't run one; that needs a physical iPhone and a team with App Group profiles for both bundle ids.
