# Native capture pipeline: why MediaRecorder was replaced, and what the references establish

**Status:** implementation on `feat/native-voice-recording` (2026-10-05), after the voice-stall regression. Hamza asked for research into how Google Meet and Zoom do reliable mobile screen + voice capture; the parent relayed the official sources.
**Scope unchanged:** private local consented capture; upload only through the existing Keep + Upload path. No vendor SDK, cloud transport or purchase.

## 1. The regression (evidence)
Android emulator (`PocketQA_Recorder_API36`, Android 16) with the old MediaRecorder build (MIC + SURFACE → one MP4). The microphone track **stopped for good** while the video went on:

| Run | Video | Voice | What was happening at the stall |
|---|---|---|---|
| lead r1, rotation | 391.7 s | 202.7 s | Maestro installing its driver package (`PACKAGE_ADDED dev.mobile.maestro` 19:22:55.98; audio ended ~19:22:56); system_server slow-dispatch storm |
| pqa-qa, rotation (attempt 2) | 2:57 | 2:48 | uiautomator dumps 20:32:11–18; voice ended ~20:32:16 |
| pqa-qa, lock | 3:44 | 2:07 | Maestro's start flow still running ~20:42:03; 294 "AudioRecord reported overrun" lines |
| lead run 5 and r3, cross-app (one Maestro session, no installs or dumps mid-capture) | 230.4 / 276.1 s | full | none |

The host load average was 15–18 throughout. **The control run (a hands-off recording) was never executed**, because pqa-qa's harness output was lost and the emulator then hung. So the correlation with bursts of system work is **not proof of causality**, and it doesn't exonerate the app.

What is certain: MediaRecorder gave no signal. Its audio just ended inside a "successful" recording. Our voice check (d6476eb) now catches that, but the capture itself must not depend on a black box that can't recover or report.

## 2. Sources and what they establish (and don't)
- **Zoom Video SDK, Android screen share** (https://developers.zoom.us/docs/video-sdk/android/share/): requests capture "through Android's `MediaProjectionManager`" and requires a "foreground service with the `mediaProjection` foreground service type", keeping `FOREGROUND_SERVICE_MICROPHONE` "to ensure the audio works as expected". Device audio needs Android 10+, `RECORD_AUDIO` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`. **Establishes** the platform route (MediaProjection + FGS with microphone), the same as ours. **Doesn't establish** Zoom's encoder or muxer internals.
- **Zoom Video SDK, iOS screen share** (https://developers.zoom.us/docs/video-sdk/ios/share/): "Use the **Broadcast Upload Extension** template" and "Use **App Groups** to establish communication between your ScreenShare target, and your application's main target." **Establishes** the iOS route, the same as ours.
- **Google Meet Help, present from Android** (https://support.google.com/meet/answer/9308856): "To share your audio, select the checkbox on the 'Present to everyone' pop-up"; "If you mute your microphone, your audio will stop being shared." **Establishes** only user-facing behaviour, **not** Meet's capture internals. We claim nothing about how Meet does it.
- **WebRTC Android `WebRtcAudioRecord.java`** (https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/src/java/org/webrtc/audio/WebRtcAudioRecord.java, fetched 2026-10-05). A reference implementation of reliable real-time mic capture:
  - a dedicated thread, `Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)`;
  - `CALLBACK_BUFFER_SIZE_MS = 10` reads;
  - `BUFFER_SIZE_FACTOR = 2` ("native buffer size of BUFFER_SIZE_FACTOR * (minimum required)");
  - explicit read errors (`"AudioRecord.read failed: " + bytesRead`, stopping on `ERROR_INVALID_OPERATION`);
  - capture times from `AudioRecord.getTimestamp(…, TIMEBASE_MONOTONIC)`.
- **WebRTC `ScreenCapturerAndroid.java`** (same repo, `sdk/android/api/org/webrtc/`): the screen path is separate from audio (a VirtualDisplay into a SurfaceTexture). It registers `MediaProjection.Callback` and handles size changes with `virtualDisplay.resize(…)`/`setSurface(…)` instead of recreating the projection.
- **Android "Media projection"** (https://developer.android.com/media/grow/media-projection): on "Android 15 QPR1 or higher … screen projection automatically stops when the device screen is locked"; apps should implement `MediaProjection.Callback.onStop()` and "release any resources … and update the app UI". Single-app sharing is on Android 14+.
- **Android "Sharing audio input"** (https://developer.android.com/media/platform/sharing-audio-input):
  - "When two apps are capturing concurrently, only one app receives audio and the other gets silence"; "If neither app is privacy-sensitive, the app with a UI on top receives audio"; "The call always receives audio".
  - Register `AudioManager.AudioRecordingCallback`: "You must call `AudioRecord.registerAudioRecordingCallback()` before the capture is started"; `isClientSilenced()` "Returns true if the audio returned to the client is currently being silenced due to the capture policy".
  - Android 11 adds `setPrivacySensitive()`. **Playback audio focus is not input ownership**: focus doesn't decide who gets the microphone.
- **AOSP Javadoc** (frameworks/base, fetched 2026-10-05):
  - `MediaMuxer.writeSampleData`: "it needs to make sure the samples for each track are written in chronological order";
  - `MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER`: "Applies only when configuring a video encoder in 'surface-input' mode … the frame previously submitted to the encoder will be repeated (once) if no new frame became available since";
  - `AudioRecord.read`: returns `ERROR_DEAD_OBJECT` "if the object is not valid anymore and needs to be recreated".

## 3. MediaRecorder vs AudioRecord + MediaCodec + MediaMuxer
| Concern | MediaRecorder (before) | Our pipeline (`CapturePipeline.kt`) |
|---|---|---|
| Mic read scheduling | internal, opaque | own thread at `THREAD_PRIORITY_URGENT_AUDIO`, 10 ms reads (WebRTC pattern) |
| Capture buffer | internal | ≥ 2 × `getMinBufferSize` **and** ≥ 0.5 s, so a scheduling stall is absorbed, not dropped. This deliberately diverges from WebRTC's low-latency 2×: recording isn't latency-sensitive. |
| Backpressure | internal; on the emulator the audio track stopped for good | bounded PCM backlog (1 s); if the AAC encoder falls behind, the oldest audio is dropped **and counted**; the capture thread never blocks |
| Timestamps | internal | `AudioClock`: sample-accurate monotonic PTS on the same clock as the screen frames. After a real overrun (lag beyond the buffer) it re-anchors forward, so audio **resumes in sync after a gap**. Never backwards. |
| Muxing | internal | `MuxGate`: MediaMuxer starts only when both tracks are known; per-track strictly increasing times; nothing before the session start; samples held (bounded) until then |
| Still screen | n/a | `KEY_REPEAT_PREVIOUS_FRAME_AFTER` 100 ms keeps video frames coming |
| Rotation | display mirrored at a fixed size | same; rotation never touches the audio thread |
| Silencing by another app or a call | polled `isClientSilenced` | `AudioRecordingCallback` registered **before** `startRecording()` plus the polled active configuration; silenced 2 s → stop (reason `mic`) |
| Dead mic or stuck thread | invisible | `Liveness`: no audio chunk for 3 s → stop (`mic`); a negative `read()` (incl. `ERROR_DEAD_OBJECT`) → stop (`mic`) |
| Lost audio inside the track | invisible | overrun gaps and backlog drops are summed (`lostAudioMs`, longest gap `maxGapMs`). **Own tight bound** (pqa-qa pipeline r1 P2-C): more than 1 s lost in total, or any single gap over 0.5 s, means "voice incomplete", whatever the clip length. The max(1 s, 2 %) tolerance applies only to the edges (encoder start-up and tail). The copy says "Parts of your voice are missing (about N s in total)". |
| Evidence | none | one log line per session: `PqaCapture stop ok=… audioGaps=… audioLostMs=… backlogDropped=… written audio=… video=… rejected=… bytes=…` (no content) |

What we deliberately do **not** do:
- set `setPrivacySensitive(true)` to keep the mic away from the app under test, which would change the behaviour being tested;
- capture app or device audio;
- promise capture through an OS-exclusive mic (call, assistant, a privacy-sensitive source, a revoked permission). Then Android gives us silence; we stop, keep what we had, and say so.

## 4. Lock: documented vs observed
The docs say projection stops on lock on Android 15 QPR1+. On this Android 16 **emulator** image, lock did **not** stop projection (seen on 2026-10-03, by pqa-qa on 2026-10-05, and in our runs: `projections=1` while locked). We don't depend on either behaviour:
- if the system stops it, `onStop` → `finish("system")` keeps the clip;
- if it doesn't, recording continues, and the chip, notification and in-app Stop remain.

Real-device confirmation is a hardware gate.

## 5. Tests
- **JVM (`PipelineLogicTest`, 10):** a 200 ms stall shifts nothing; a 2 s overrun re-anchors forward with the loss counted; never backwards; bounded backlog drops oldest; liveness (silenced 2 s, no audio 3 s, recovery forgiven); mux gate (starts with both tracks, holds earlier samples, relative times, strictly increasing, bounded hold).
- **`VoiceCheckTest` (+1):** lost audio counts against the voice.
- **Emulator:** `voice-stress.sh` replays the stimuli seen at the stalls (rotation, uiautomator dump bursts, a dexopt burst, lock) during ONE live recording, driven by adb only. `MODE=control` is the same recording hands-off. Each clip goes through `check-voice.py`.

## 6. Evidence gate (`check-voice.py`), revised after pqa-qa pipeline r1 P2-D
- **Durations:** the track durations alone can't see a timestamp gap (the track spans it). The gate now also compares the samples actually held with the stream duration (fail above 0.5 s), and decodes with `aresample=async=1:first_pts=0`, so a gap becomes silence the 5 s RMS windows see.
- **RED:** `fixtures/voice-gap-3s.mp4` (a sine with a 3 s timestamp gap) PASSED the old gate. **GREEN:** it now fails. `check-voice-selftest.sh` pins 8 verdicts.
- **Tail bug fixed:** the last window used to be treated as an "allowed tail" even without `--allow-silent-tail`.
- **`--structure-only`** skips the signal check, for inputs known to be digital silence. Its verdict reads "PASS (structure only: continuous audio track; NO signal check)", and it is never reported as audio proof.

## 7. Emulator infrastructure note
Fresh emulator instances launched with the host mic switched off (`hostmicoff`) aborted inside the host's CoreAudio as the guest opened the mic. Crashpad dumps: 20:24 (pqa-qa) and 23:02 (lead), with "abort() called", `IsolatedCoreAudioClient`, `CoreAudioOrchestration`, right after "Failed to create voice `virtio-snd-mic0'". This happened with both the old and the new build. Two bounded alternatives were tried:
- **`-no-audio`:** stable, and the host's audio and mic are never touched. But the guest's built-in mic then delivers **digital silence**: the HAL logs "pcm_readi was late delivering frames, inserting … us of silence", and our cross-app clip measured −120 dBFS, correctly FAILED by the gate.
- **`-prop ro.boot.audio.tinyalsa.simulate_input=true`** (the HAL's own 300 Hz generator, `device_port_source.cpp`): not applied by this emulator (`getprop` empty).

So, on the new pipeline, the emulator can prove **continuity and structure** (stream durations, no timestamp gaps, and the `PqaCapture` stats: gaps, lost ms, dropped chunks, samples written). It can **not** prove a non-silent signal: that is BLOCKED (infra) here and is part of the device gate (a real phone with real speech). The earlier non-silent emulator evidence (run 5, r3) is from the MediaRecorder build.
