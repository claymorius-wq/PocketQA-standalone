# pqa-qa: Android capture pipeline (voice-stall root-cause fix), read-only review r1

**Candidate:** `fdc8e95` on `feat/native-voice-recording`. The code delta `c5e629d..fdc8e95` covers:
- `CapturePipeline.kt` (new);
- `PipelineLogic.kt` (new);
- `ScreenCaptureService.kt`;
- `VoiceCheck.kt`;
- `PipelineLogicTest` and `VoiceCheckTest`.

**Method:** read-only. No builds, no emulator.

## What holds
- **Ownership:** MediaRecorder is replaced by stages we own, so a stall can no longer be invisible:
  - `AudioRecord` (MIC, 44.1 kHz mono, an `URGENT_AUDIO` thread, 10 ms reads, a buffer of at least 2× minimum and at least 0.5 s);
  - a bounded PCM backlog;
  - an AAC `MediaCodec`;
  - a surface-input H.264 encoder with `KEY_REPEAT_PREVIOUS_FRAME_AFTER`;
  - `MuxGate`, which starts the muxer only with both tracks, keeps each track's PTS strictly increasing, and is `@Synchronized` across the two threads.
- **Shared clock:** the screen frames and `AudioClock` use the monotonic `System.nanoTime` base. The clock advances by samples and re-anchors forward only when the lag exceeds the capture buffer. Gaps and lost µs are counted.
- **Liveness:**
  - the `AudioRecordingCallback` is registered before `startRecording` and is backed by polling the active config;
  - silenced for 2 s → `mic`;
  - no chunk for 3 s → `mic`;
  - read error → `mic`;
  - encoder or thread exceptions → `error`.
  - Fatal callbacks are posted to main.
- **No silent success:** `stop()` returns false unless both tracks were written. The service then reports `error` and forgets the file. `VoiceCheck.inspect(file, lostAudioMs)` subtracts the audio lost inside the track.
- **Caps:** duration by a main-thread runnable, size via `gate.bytes`.

## Findings
**P2-C: lost narration in the middle of a clip is accepted up to max(1 s, 2 %)**
- **Where:** `VoiceCheck.inspect` and `covers`.
- **Problem:** `lostAudioMs` is subtracted from the audio duration and then judged by the **edge** tolerance, which was justified as encoder start-up and tail slack.
- **Effect:** a 10-minute clip can silently lose up to 12 s of narration in the middle (18 s at the 15-minute cap) and still be marked `voiceComplete`, then be offered and uploaded as narrated evidence.
- **Required:**
  - judge mid-track loss separately, with a tight bound (for example total `lostAudioMs` > 1 s, or any single gap > 0.5 s, gives incomplete);
  - keep the edge tolerance for start and tail only;
  - add tests at the boundary.

**P2-D: the evidence gate (`e2e/maestro/check-voice.py`, unchanged) is blind to timestamp gaps**
- **Problem:** with the new pipeline, an overrun leaves a **PTS gap** inside the AAC track:
  - ffprobe's stream duration still spans the clip, so the |a−v| check passes;
  - `ffmpeg … -f s16le` concatenates the decoded samples without filling the gap, so the 5 s RMS windows never see the missing time.
- **Effect:** the harness could report PASS on a clip with a hole in the voice.
- **Required:**
  - make the gate compare **decoded sample count / sample rate** with the audio stream duration (≤ 0.5 s), or decode with `-af aresample=async=1:first_pts=0` so gaps become silence the windows detect;
  - prove it RED on a synthetic gapped MP4 (for example two AAC segments with a 3 s PTS jump), then GREEN.

**P3, non-blocking**
1. **Misleading copy for gaps.** For a mid-clip gap, the copy "Voice stops at X of Y" is wrong. Say "N s of your voice is missing" when the loss came from gaps rather than the tail. That means carrying `lostAudioMs` and the gap count in the meta or clip.
2. **Finalising on the main thread.** `finish()` runs `p.stop()` on the main thread: two joins of up to 3 s each plus `muxer.stop()`. That's within the service time limit, but it blocks the app's main looper. Finalise on a worker and post the result.
3. **Evidence log line.** `Log.i(PqaCapture, stop … audioGaps … audioLostMs …)` holds no content, which is good. **Cite that line in every evidence run:** gaps 0 and lost 0 ms is the direct proof the stall is gone.

## What the emulator evidence must show (before I can approve)
1. **A hands-off control:** at least 4 minutes, no UI automation during capture.
2. **The stress run:** the stimuli that stalled MediaRecorder (uiautomator dumps, Maestro sessions, rotation, lock, Home → Settings, package install) during **one** live recording.
3. **Gates on every clip:**
   - the fixed `check-voice.py` passes (P2-D);
   - the `PqaCapture stop` line with `audioGaps`, `audioLostMs` and `backlogDropped`;
   - the in-app verdict.
4. **The four scenarios still outstanding** (call, micoff, dka, death) on this build.
5. **Infrastructure:** `-no-audio` is accepted as emulator infrastructure, since host CoreAudio aborts with `hostmicoff`. The audio is the guest HAL's synthetic 220 Hz tone, **not speech**. A ≥ 10-minute real-phone capture stays a device gate.

## r2: the fixes at `30a98d9` (read-only, plus my own run of the gate)
| r1 | Change | My evidence | Status |
|---|---|---|---|
| **P2-C** | `VoiceCheck.covers(video, audio, lostMs, maxGapMs)`: **total lost > 1 s or any gap > 0.5 s gives incomplete, whatever the length**. The edge tolerance now applies to start and tail only. `AudioClock.maxGapUs` is tracked, and `lostMs` is persisted in the meta and the clip. JS copy: "Parts of your voice are missing (about N s in total)" | Code read; the 10-min/12-s case is a unit test (by the lead's report) | **fixed** |
| **P2-D** | `check-voice.py`: compares samples held against stream duration (> 0.5 s fails), uses `aresample=async=1:first_pts=0` for the RMS windows, and fixes the tail bug (the last window was always allowed). `--structure-only` is labelled "NO signal check" | **My run** of `check-voice-selftest.sh` from a clean `git archive` of `30a98d9`: **8/8 verdicts as pinned**. **My own independent fixture** (12 s video, a 330 Hz sine with a 6 s PTS hole, made with ffmpeg) gives `audio samples held 5.991 s of 11.990 s; timestamp gaps 5.999 s` and a quiet window at 5–10 s: **FAIL**, as required | **fixed** |
| **P3:** copy | Missing-parts copy | Read | fixed |
| **P3:** main thread | stop, drain, finalise and VoiceCheck run on the `pqa-capture-finish` thread. `cleanup`, notify and `stopSelf` are posted to main. The file stays the active file until `markComplete`, so the sweep race stays closed | Read | fixed |
| **P3:** stats line | `voice-stress.sh` cites the `PqaCapture stop` line per run | — | pending the evidence |

**Signal status:**
- **Infrastructure:** fresh emulator instances with host audio abort in CoreAudio when the mic first opens, which my 20:24 crash dump also shows. With `-no-audio`, the guest mic is digital silence.
- **What the new pipeline can show on the emulator:** structure only (one continuous AAC track covering the video, `audioGaps`, `audioLostMs` and `backlogDropped` from `PqaCapture stop`). It **cannot** show a non-silent microphone signal.
- **Where signal was shown before:** only by the old MediaRecorder runs (the goldfish HAL's 220 Hz tone, run 5 and r3).
- **Therefore:** "the microphone signal reaches the file" on `30a98d9` is **BLOCKED (infra)** on emulator and is a **device gate**, alongside the ≥ 10-minute real-phone capture.
