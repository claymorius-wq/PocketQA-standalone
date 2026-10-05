# pqa-qa: desktop web screen + microphone recording, verdict r2

**Candidate:** `fd22f01bfeba73b2b29c8a94f9b968cc03939ad4` (`feat/screen-recording`). The delta against r1's `9b9d631` is 21 files, 1 commit. The full feature delta is `6028f08..fd22f01`.

**Setup:**
- I worked in detached `.worktrees/qa-sr-run` on Node v24.21.0.
- **Synthetic media only:** headless Chromium with fake devices and fake UI. No real screen, window or microphone was captured.
- No cloud, push, deploy or preview runs. I read no `.preview*` files and didn't run `recorder-smoke.mjs`.
- My temporary probe spec and artefacts were removed. The tree is clean.

## Gates I ran
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. check:secrets 897 files, no findings. Scripts 60; contracts 17; domain 216; API 573 + 2 skipped; mobile **1145/1145** |
| Full Playwright × 2 (`mobile-web` + `desktop-recorder`) | **21/21 PW_EXIT=0, twice.** The lead reports three more green runs. The decode gate inside these runs includes ffprobe (one video + one audio stream), the ffmpeg decode, and the volume check |
| Mobile Jest alone × 2 (after the parent's report) | **1145/1145 both times** |
| The parent's 3 failures, isolated | `patterns.test.tsx`, `review-screen.test.tsx`, `admin-screens.test.tsx` run alone: **95/95 pass** |

## The parent's Jest failures (`/tmp/pqa-screen-r2-parent-verify.log`): investigated, not dismissed
- **What failed:** 3 tests, each `Exceeded timeout of 5000 ms`:
  - `patterns in dark › ListCard…`;
  - `review screen › U7…`;
  - `Disputes › opens each Resolve sheet clean…`.
- **Not in the delta:** `git diff --stat 6028f08..fd22f01` touches **none** of these suites or their components (`src/ui`, review and admin screens and tests): the stat is empty.
- **Load is the cause:** the parent's run overlapped my verify and Playwright. Its slowest suites took **49–53 s**, against **17–23 s** in my uncontended verify, so the failing suites ran 3× slower. The same three suites take 11.7 s, 16.6 s and 19.2 s in my verify, and pass alone and in two full uncontended Jest runs.
- **Conclusion:** load-induced timeouts in pre-existing UI tests, **not caused by this candidate**. That's recorded as P3-3 below rather than dismissed; no assertion is weakened.

## r1 findings
| r1 | Change | My independent evidence | Status |
|---|---|---|---|
| **P2-1:** a never-answered mic prompt leaves the screen live with no way out | `cancel()` in `requesting-screen` and `requesting-mic`: generation bump, `releaseAll`, back to `ready` with "Cancelled. Nothing was recorded." A screen `ended` listener is attached in `withScreen`; the recording's listeners replace it. The card shows `web-rec-cancel` while asking | **Real Chromium, `getUserMedia` never settles:** Cancel takes the screen track from `video:live` to `video:ended`, shows "Cancelled. Nothing was recorded.", re-enables Start, and hides Cancel. The browser's "Stop sharing" (`ended` on the screen track) takes it `live` → `ended` with "You stopped sharing before recording started. Nothing was recorded.", and re-enables Start. **A late mic answer after Cancel:** both tracks `ended`, the state stays cancelled, no review draft | **fixed** |
| **P2-2:** flaky decode gate | `e2e/ffmpegCheck.ts` ignores **only** the anchored line `^\[null @ 0x…\] Application provided invalid, non monotonically increasing dts to muxer in stream N: A >= B$`. Every other line, and any nonzero exit, still fails (9 unit tests) | Read the regex (fully anchored, null muxer only). Full Playwright 2/2 green here | **fixed** |
| **P3-1:** WebM has no duration | Documented in `usability-guide.md` | — | **addressed** |
| **P3-2:** dead card after a bfcache restore | A disposed-under-mounted card shows "This recording was closed… Nothing was kept." with **Start over**, which creates a fresh controller and **resets consent** | Code read; card tests in the 1145 | **fixed** |

**Still holding from r1 (rechecked):** my r1 QA-B probe found object URLs balanced and nothing sent. The listener swap only touches `withScreen`/`withMic`, and the recording path is unchanged.

## New in r2: `scripts/preview/recorder-smoke.mjs`
**This smoke is NOT the in-app recording flow:**
- It checks the `permissions-policy` header, then the gate, the demo tester's sign-in, and that a study page shows "Browser recording available". These use the app.
- It then **injects its own button and raw `getDisplayMedia` / `getUserMedia` / `MediaRecorder` script** for 1.5 s.
- That proves only that the **policy and browser engine allow capture on the origin**. It does **not** exercise `WebRecorderCard` (consent, start, stop, replay, download, discard). That flow is covered **only by local Playwright** on the desktop-recorder project.

**Safety review:**
- It's non-destructive: no study is joined or created.
- Credentials from `access.txt` are typed, never printed. Only the first line of any error is printed (Playwright's first line doesn't include fill values).
- Media is synthetic and headless.
- I did **not** run it: it reads `.preview*` state, and the public preview is out of my scope.
- The lead's rehearsal output (`preview-smoke-rehearsal.txt`) is the lead's evidence, not mine.

## Residual notes (P3, non-blocking)
1. **Smoke wording in the guide.** `usability-guide.md` "Public preview smoke", item 4, should say explicitly that the probe is an injected raw-API script and not the app's recorder, so a pass isn't read as "the in-app recorder works on the public preview".
2. **Cancel during the share dialog.** The cancel in `requesting-screen` is untestable here, because the fake UI answers instantly. In real Chrome, the share picker may sit over the page, so the late-answer path (stale generation → tracks stopped) is the effective guard. That path is unit-tested.
3. **Pre-existing timing-sensitive UI tests** (`patterns`, `review-screen`, `admin-screens`) time out at 5 s under heavy parallel load. Track and fix separately (per-test timeouts or test splitting), without weakening assertions. Not caused by this candidate.

## Limitations (stated)
- **No real chooser or devices.** No real OS/browser share dialog, real microphone or real screen content (fake devices; the fake UI captured the app's own tab despite `selfBrowserSurface: 'exclude'`). Chromium only: not Firefox, Safari or Edge.
- **Stop sharing simulated.** "Stop sharing" was simulated by dispatching `ended`; the browser bar wasn't pressed.
- **Not tested on the deployed origin.** Neither the deployed HTTPS preview nor production headers were tested live by me. The header values are unit-tested in both servers.
- **Public smoke is engine-only.** The public-preview smoke is an engine and policy probe, not the in-app flow.
- **Native not on a device.** The Android native recorder is unchanged in the diff and its Jest suites pass. It wasn't exercised on a device in this review.

## Verdict
**APPROVE `fd22f01bfeba73b2b29c8a94f9b968cc03939ad4`.**
- Both r1 P2s are fixed and verified independently in real Chromium on synthetic media.
- `pnpm verify` and full Playwright are green in uncontended runs.
- The parent's three Jest failures are load-induced timeouts in suites this candidate doesn't touch (P3-3).
- The approval covers a **local-only** desktop web recorder (narration plus a screen the user chooses, with replay, download and discard, never uploaded), with the limitations above.

VERDICT: APPROVE

## Addendum: docs-only follow-up `efbc18ee55abc3355acb7e30ef6fafb65a52f0bc`
**Scope:**
- It descends directly from `fd22f01`.
- `git diff --stat fd22f01 efbc18e` touches 6 files. Under `apps/` and `scripts/` the only change is a **comment** in `scripts/preview/recorder-smoke.mjs`, and `node --check` passes.
- My threat review r1 and verdicts r1/r2 were copied **byte-identical** (`cmp`).

**My P3s:**
- P3-1 is resolved: the guide's smoke item 4 and the script header now say the probe is an injected raw-API check of policy and engine, **not** the app's recorder. They also say the in-app card is covered only by local desktop Playwright, and that Stop sharing is simulated.
- P3-3 is logged in `progress.md` as a separate follow-up.

**Secrets scan:** `check:secrets` at `efbc18e` passes.

**Approval:** the APPROVE extends to `efbc18e`. The parent may merge `fd22f01` or `efbc18e`; the executable code is identical.
