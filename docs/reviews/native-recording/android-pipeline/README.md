# New capture pipeline on the Android emulator (2026-10-05/06)

- **Builds:**
  - p3 = APK `2a7c2588…` (code `30a98d9`);
  - p4 = APK `67b4e443…` (`44fea59`: the same pipeline plus the off-screen entrance fix).
- **Emulator:** own AVD `PocketQA_Recorder_API36`, launched with `-no-audio`, so the host's audio and microphone are never touched.
- **What these runs prove:** the guest microphone delivers **digital silence**, so every audio verdict here is **structure only**: stream durations, no timestamp gaps, and the pipeline's own `PqaCapture` stop line.
- **What they don't prove:** that a signal or a voice reaches the file. That needs a real phone, with real speech, recorded for at least 10 minutes.

| Scenario | Stimulus during one live recording | `PqaCapture` stop line | Gate (structure only) | Result |
|---|---|---|---|---|
| control | hands-off, ~150 s | gaps 0, lost 0 ms, dropped 0, written audio 8649 / video 6266 | video 200.884 s, audio 200.829 s, gaps 0.000 s | PASS |
| stress | rotation landscape → portrait, 2 × 5 uiautomator dumps, a forced dexopt of Clock, lock 8 s (projection stayed live) | gaps 0, lost 0, dropped 0, audio 10255 / video 7399; overrun lines 0 | 238.188 / 238.121 s, gaps 0 | PASS: the stimuli that coincided with MediaRecorder's stalls no longer break the track |
| call | emulator phone call while in Settings | gaps 0, lost 0; `AF::RecordTrack: setSilenced … (silenced)` → session stopped by itself ~3 s later (reason `mic`) | p4: 60.943 / 60.674 s, gaps 0 | PASS (p4). **p3 found a UI bug:** the clip row and the stop notice, added while the app was off screen, stayed invisible (`call-before-fix-blank.png`). Fixed in `44fea59` (`call-clip-visible-after-fix.png`). |
| micoff | `appops set … RECORD_AUDIO ignore` for 8 s | gaps 0, lost 0 | 82.434 / 82.268 s, gaps 0 | PASS as a normal recording. **The mic-loss path was NOT exercised:** this image didn't silence a capture that was already running. The call covers silencing. |
| dka | `always_finish_activities=1` while away (the activity was recreated on return) | gaps 0, lost 0 | 85.721 / 85.612 s, gaps 0 | PASS: the recording survived the destroyed screen and the clip came back (P2-A) |
| death | `am force-stop` while recording | — (killed) | no clip expected | PASS (p4, after a manual return through My work): "A recording was interrupted … couldn't be saved. Nothing from it was uploaded." and no clip row (`death-interrupted-notice.png`) |

## Harness issues found and fixed (not product defects)
- `bash 3.2` + `set -u` aborted the gate on an empty array (control and stress: their gate was re-run by hand on the same files).
- The death return looked for the study on Discover, but a joined study lives under My work.
- While the entrance bug was live, uiautomator reported "could not get idle state".

## Infra, bounded and documented
- Fresh emulator instances with host audio aborted in host CoreAudio at the first mic open (crashpad dumps 20:24 and 23:02).
- `-prop ro.boot.audio.tinyalsa.simulate_input=true` was not applied.
