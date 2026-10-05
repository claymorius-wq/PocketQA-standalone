# pqa-qa: native screen + voice recording, freeze verdict r2

**Candidate:**
- **Code:** `0aaa89b30236e2bce898ed88e644295cae49e458` (`feat/native-voice-recording`). Branch HEAD `246c2a5` adds docs only: `git diff --stat 0aaa89b 246c2a5 -- . ':!docs'` is empty.
- **Merges in:** iOS (`pqa-ios` up to `267fca4`) and `origin/main` `daf0c85` (intro, badges).
- **Android APK at this code:** sha256 `6bd0d35afc7017ceef1a948af42c00f869cc59264889ab44d1a44769624095b9` (the lead's build, debug-signed).
- **Superseded:** my r1 (MediaRecorder build `c5e629d`).

## Gates I ran myself (Node 24, detached `.worktrees/qa-nv-run`, exclusive slot)
| Gate | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. check:secrets 1018 files, no findings. Scripts 60; contracts 17; domain 222; API 573 + 2 skipped; mobile 63 suites / **1347** |
| Full Playwright | **28/28**, PW_EXIT=0 (screenshots restored) |
| `check-voice-selftest.sh` (from a clean `git archive` of `30a98d9`; the gate is unchanged since) | 8/8 pinned verdicts. **My own** gapped fixture (a 6 s PTS hole) **FAILS**, as required |
| **Re-gating of the lead's emulator clips** (`.results/p3`, `p4`, `p5`) with `check-voice.py --structure-only`, plus each `PqaCapture stop` line | See the next section |

## Android emulator evidence (the lead's runs; I re-checked the files)
- **Setup:** own AVD `PocketQA_Recorder_API36` (Android 16 / API 36) with `-no-audio`, so host audio is never touched.
- **The pipeline:** the native code is unchanged since `30a98d9`. The later commits are JS UI (`44fea59`, `0aaa89b`) and the main merge.

| Scenario | Video / audio (s) | Timestamp gaps | PqaCapture | Result |
|---|---|---|---|---|
| control (hands-off) | 200.884 / 200.829 | 0.000 | gaps 0, lost 0, dropped 0, rejected 0 | PASS (structure) |
| stress (rotation, uiautomator bursts, dexopt, lock, all in **one** recording) | 238.188 / 238.121 | 0.000 | 0 / 0 / 0 / 0 | PASS (structure). The stimuli that stalled MediaRecorder no longer break the track |
| call (p4, after the `44fea59` UI fix) | 60.943 / 60.674 | 0.000 | 0 / 0 / 0 / 0; silenced, then stopped with reason `mic` | PASS. The clip and notice are visible on return |
| micoff (appops ignore, 8 s) | 82.434 / 82.268 | 0.000 | 0 / 0 / 0 / 0 | PASS as a recording. **The mic-loss path was not triggered** on this image; silencing is covered by the call |
| dka (`always_finish_activities=1`) | 85.721 / 85.612 | 0.000 | 0 / 0 / 0 / 0 | PASS. The recording survived a destroyed screen (P2-A) |
| death (`force-stop`) | no clip expected | — | — | PASS (p4). "Interrupted … couldn't be saved. Nothing from it was uploaded." No clip row |
| cross-app at the combined build (p5; intro shown and skipped, not re-shown) | 49.009 / 49.017 | 0.000 | 0 / 0 / 0 / 0 | PASS (structure). sha `7cfd9c26…` matches |

**Signal:** the `-no-audio` guest microphone delivers **near-silence (codec noise floor)**. My `volumedetect` on the control clip reads mean −91.0 dB, max −71.2 dB. So these runs prove **continuity and structure only, not that a signal or voice reaches the file**.

**Infrastructure:** fresh emulator instances with host audio abort in host CoreAudio when the mic first opens (crashpad 20:24, mine, and 23:02, the lead's).

## Findings status
| ID | Item | Status |
|---|---|---|
| **P1** (r1) | Undetected voice stall | **Fixed and root-caused:** an own AudioRecord / MediaCodec / MediaMuxer pipeline, with the voice check on the file |
| P2-A | Background unmount discarded the recording | fixed (dka evidence) |
| P2-B | A/V and signal gates | the structure gate passes on all runs; the **signal gate is device-only** (see below) |
| P2-C | Mid-clip loss bound | fixed (total lost > 1 s or any gap > 0.5 s means incomplete) |
| P2-D | Gap-blind evidence gate | fixed, and verified with my own fixture |
| P3s (audit r1, pipeline r1) | | fixed |
| P3 | Intro entrance off screen (`useEntranceDelay`) | fixed in `0aaa89b` (jest RED → GREEN) |

**Open P0/P1/P2: none.**

## Not verified (device gates; stated, not claimed)
1. **Signal on the shipping pipeline:** that a **non-silent microphone signal or real speech** reaches the file. It's BLOCKED (infra) on the emulator and needs a **real phone**, including a **≥ 10-minute capture under normal use**, gated with `check-voice.py` **with** the signal check.
2. **Seeker:** **not verified.** No Seeker hardware was used, and every Android claim is emulator-only.
3. **iPhone:**
   - **Compile:** the simulator build succeeded (pqa-ios, unsigned).
   - **Not run:** the broadcast extension has **never run**. That needs a physical iPhone plus App Group provisioning for both bundle ids.
   - **Untuned:** orientation, the picker workaround and the mic thresholds are disclosed and still need tuning.
4. **The mic-loss path through appops:** not triggered on this image.
5. **Physical behaviours:** the real Android 15+ status-bar chip and lock-screen stop.

## Verdict
**APPROVE for code `0aaa89b` (branch `246c2a5`)**, scoped to what's proven: Android capture structure, lifecycle and privacy behaviour on the emulator, the regression gates above, and an iOS compile.

**Not approved here:**
- the **device signal gate**: real phone, real speech, ≥ 10 min;
- Seeker;
- an iPhone runtime.

These must pass before any claim that narration recording works on a phone.

VERDICT: APPROVE
