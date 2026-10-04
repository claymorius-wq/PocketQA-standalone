# Freeze candidate: the Lens screens (PR #3), updated against main after PR #2

**Branch:** `feat/lens-ui` (PR #3). **Candidate:** `ad99009`. Every command output in this folder ran on it except three baseline files, which say what they ran on: `windows-baselines-origin-main.txt`, `offline-test-origin-main.txt` and `offline-test-75e009a.txt`. The commit that adds this folder changes nothing else.
**Base:** `main` at `9461db5`: PR #1 (the Lens foundation) and PR #2 (Firebase identity, web wallet login, private R2 evidence).
**Scope:** UI only (ADR 0006).
- Nothing outside `apps/mobile` and `docs` changes: `git diff --stat origin/main ad99009 -- . ':!apps/mobile' ':!docs'` is empty.
- Inside the app, `src/api`, `src/auth`, `src/lib`, `src/preview` and `src/wallet` are main's, except WalletSection's drawing.

## Commits since main
- `0e5b1d0` feat(ui): every screen rebuilt in the Lens design (the original PR #3).
- `3f02178` Merge main (PR #2).
  - Conflicts were in `app/(auth)/sign-in.tsx`, `sign-up.tsx` and `e2e/review-loop.spec.ts`.
  - Every PR #2 flow is kept with its copy and testIDs: Google, wallet sign-in, "Create an account with this wallet", "Finish your account", "Check your email" and the cloud footer.
  - Its tree is identical to the integration that was tested before PR #2 merged.
- `75e009a` docs: the Lens ADR is now 0006. The cloud identity ADR keeps 0005, which about 45 files and its reviews cite.
- `4875dbd` fix(ui): the r1 review (below).
- `058268d` test(e2e): the offline check is scoped to My work (below).
- `ad99009` fix(ui): the r2 review (below).

## Bug on main that this fixes
"Check your email": main's sign-up passes the kit `Notice` three pieces (a string, the email, a string), and the Notice wrapped only a single string.
- On web the instructions render as bare DOM text, in the browser's default black on the dark notice.
- On native (RN 0.86, Fabric) they are never drawn: only the title shows.
- Traced in `verdict-qa-r1-auth.md`.

PR #3 passes one string. The kit `Notice` now also wraps any text-only children (strings and numbers), and `e2e-firebase` checks that the body is styled text.

## Evidence
Windows 11, Node 24.21.0, pnpm 10.32.1. Local paths are shortened to `<repo>` and `<tmp>`; the emulator's one-time codes are masked.

| Command | File | Result |
|---|---|---|
| `pnpm verify` | `pnpm-verify.txt` | check:secrets passes (590 files); assert-no-secrets, typecheck and lint pass. The root `scripts/*.test.mjs` pass 33/37 (Windows baseline 1); `verify` stops there (`&&`). |
| `pnpm -r --if-present test` | `pnpm-test.txt` | contracts 15/15; domain 170/170; API 341 passed, 2 skipped, 1 failed (Windows baseline 2). `pnpm -r` stops at that package. |
| `pnpm --filter @pocket-qa/mobile test` | `pnpm-test-mobile.txt` | 42 suites, 983 tests: all pass. |
| Playwright web e2e | `playwright.txt` | 11/11. That is the five spec files, including the 3 `wallet-login` tests from PR #2. |
| `pnpm test:emulator` (API ↔ Firebase Auth emulator) | `firebase-emulator.txt` | Both tests pass. Vitest still marks the file failed (Windows baseline 3). |
| `pnpm test:e2e:firebase` | `playwright-firebase.txt` | 2/2, with the new "Check your email" body check. |
| The offline test alone | `offline-test-*.txt` | Before `058268d` it fails alone, on main and on `75e009a`; on `ad99009` it passes. |

**Windows baselines.** PR #3 touches none of `scripts/`, `apps/api` or `packages/`: `git diff --stat origin/main ad99009 -- scripts apps/api packages` is empty. So these three tests run the same code here as on main 9461db5. They were not rerun on 9461db5 itself.
1. Four preview-script checks assert POSIX file mode 0600, and Windows reports 0666.
2. `config.bind.test.ts` expects the POSIX path `apps/api/.data`, and Windows returns backslashes.
3. The emulator test's `afterAll` gets EPERM when it deletes its temp folder, because the SQLite file is still open.

Baselines 1 and 2 were also measured on this machine on 2026-10-03, on the clone's main at that time: `d358a05`, before PR #1 and PR #2 (`windows-baselines-origin-main.txt`). Both fail there the same way. Baseline 3 came with PR #2's test file, so it has no earlier run.

**How the Playwright runs were made.** `playwright.config.ts` and `playwright.firebase.config.ts` start their servers with POSIX `VAR=x cmd` syntax, which Windows can't run, and port 8787 is taken on this machine. So both ran through a git-ignored mirror under `apps/mobile/artifacts/integ`:
- the same specs and servers, on ports 8788 (API), 8091 (web) and 8900 (fake devnet RPC);
- the variables passed through `env:`;
- a fresh `expo export` per run;
- screenshots written under the mirror, so the committed `docs/reviews/gate-a` and `remaining-scope` images are untouched.

The specs' only change is the port numbers.

**The offline test.** `review-loop.spec.ts` "offline state when the API is unreachable" looked up the first `empty-state` on the page.
- Discover stays mounted in its tab scene, and for a new tester with no device profile it shows an empty-state too.
- The unscoped lookup then finds two elements and fails in strict mode. Whether that happened depended on what earlier tests left in the database: it passed in the first full run of `75e009a` and failed on `4875dbd`.
- Run alone it fails on main too (`offline-test-origin-main.txt`).
- `058268d` asks for My work's empty-state, which is what the test means.

## Review
**Who reviewed.** The verdicts use the `pqa-qa` format, but Hamza's `pqa-qa` Herdr pane did not write them. They come from independent subagents of the Claude Code session that made this PR (`claude-opus-5-5`):
- each started fresh, with none of the author's reasoning;
- each was read-only: git, Read and Grep, with no builds, runs or edits;
- each verdict is committed verbatim.

Round 1 had four reviewers, one per area:

| Area | File | Verdict | Findings |
|---|---|---|---|
| Auth and the PR #2 merge | `verdict-qa-r1-auth.md` | APPROVE | 3 P3 |
| Tester flows | `verdict-qa-r1-tester.md` | APPROVE | 4 P3 |
| Builder and admin | `verdict-qa-r1-builder-admin.md` | CHANGES_REQUIRED | 1 P2, 5 P3 |
| Kit, glass, motion, theme, platform | `verdict-qa-r1-kit.md` | APPROVE | 8 P3 |

**Fixed in `4875dbd`: the P2 and 17 of the 20 P3s.**
- **The P2 (builder study sheets).**
  - A failed Close's error no longer reappears, or is announced, in the next sheet.
  - The sheet keeps its title, confirm and tone while it animates out.
- **Admin sheets** keep their note while closing.
- **Builder study and Review** hide their dock while the error panel shows.
- **Accessibility.**
  - Each evidence View button names its item.
  - The "Decision" title is a heading.
  - Cards are one stop, with a hint.
  - The clip and recorder groups have a role.
  - Web gets `aria-checked` and `aria-busy`.
- **Web layout.** The budget figure fits its column on web.
- **Sessions.**
  - The U4 hold locks Submit and Withdraw, and the notes become read-only.
  - Withdrawn sessions show the task recap again, as on main.
- **Sign in.**
  - U1 dims the key light.
  - Return in the password field signs in.
- **Kit hardening.**
  - Notice wraps text-only children.
  - The Commit-pass lock needs `onLeave`.
  - The header clips on web only.
  - Dead code is removed.
- **Docs.** ADR 0006 is brought up to date.

**Open after all three rounds, with reasons:**
- **Tester 4: no native run on a Lens build yet.** This needs a device; see Gates.
- **Kit 1: web keyboard focus under the header scrim and docks** (WCAG 2.4.11). It affects keyboard users of the web preview. The fix is a web `scroll-padding` plus a Playwright tab-through check, as a follow-up.
- **Builder/admin 2: kept.** Review keeps a cancelled reason for the same participation, as main does. The text stays visible in the field.
- **r3 1: after the 15 s pending escape, a sheet opened for a different action or row stays bound to the request that is still running.** It is left for a follow-up, because it needs a request hung for over 15 s, then Cancel, then a different sheet. Main has the same flaw in a worse form.
  - **Every sheet.** The sheet names the new action, but shows the old request's spinner and result.
  - **Publish and Approve.** After a lit Publish or Approve, the sheet can stay open. On Review the dock state then sticks until the screen remounts.
  - **Admin screens on web.** A confirm made while the browser reports offline is paused. When the connection returns it runs against the row opened since, with that sheet's draft.
  - **The fix,** as the review suggests:
    - while a request is pending, reopen the sheet on that request's own action or row;
    - pass each request's target and fields as `mutate()` variables, so it always acts on what was confirmed.

**Round 2** (`verdict-qa-r2.md`): APPROVE. It confirmed every r1 fix, accepted the three open items, and agreed that `058268d` hides no bug. It found three new P3s:
1. **Opening a sheet detached a request that was still running** (after the 15 s pending escape). Fixed in `ad99009`: the five sheets now reset only when nothing is pending. A Builder study test pins it, and it fails without the guard. The other four guards are untested.
2. **Some fixes had no test.** Fixed in `ad99009`; these are now tested:
   - no dock while the error panel shows;
   - the admin sheets keep their note on success;
   - the group labels;
   - `aria-checked` in Playwright.
3. **Records.**
   - ADR 0006 now records the two kit removals (`ad99009`).
   - The rest arrives with the commit that adds this folder: this file, the offline-test outputs, and the PR #3 entries in `docs/verification.md` and `docs/progress.md`.

**Round 3** (`verdict-qa-r3.md`): APPROVE.
- It confirmed the three r2 fixes, and traced that each new test fails if its fix is reverted.
- It corrected this file in four places, all applied here: which outputs ran on older commits, what the Windows baseline file ran on, the r2 records, and this line.
- It found one new P3, left open (below).

## Gates and limits (not done here)
- **Native.** No Android or iOS run on a Lens build yet. Hamza's Mac and Seeker are needed for:
  - a dev-client rebuild for Reanimated 4 / worklets;
  - the 11 Maestro flows in `e2e/maestro/run-native.sh`, plus `ios-smoke` and `ios-settings`;
  - the Seeker performance check (SVG canvases per screen, Perf Monitor). ADR 0006 records the header scrim as a known excess on commit sheets.
- **Light theme.** It works (flat) and passes contrast; the light Lens look is deferred.
- **CI.** This repo has none, so everything above ran on one machine, and its outputs are committed here.
