# Freeze candidate: Lens follow-ups (the two P3s left open by PR #3)

**Branch:** `fix/lens-followups`. **Candidate:** `fdb92e4`. Every command output in this folder ran on it, except `focus-mutation.txt`, which says what it ran on. The commit that adds this folder changes nothing else.
**Base:** `main` at `637fe3d` (PR #3 merged).
**Scope:** UI and its tests only. Nothing outside `apps/mobile` and `docs` changes.

## Commits
- `07fba32` fix(ui): bind each sheet's request to what was confirmed (PR #3 r3, finding 1).
- `2a1bde2` fix(ui): keep web keyboard focus clear of the header scrim and docks (PR #3 kit r1, finding 1).
- `7dab6ef` test(e2e): an interim relaxation for text boxes, replaced by `fdb92e4`.
- `fdb92e4` fix(ui): web multi-line fields come wholly into view, and the focus test checks both cause and effect. This covers P3s 2 to 4 of `verdict-qa-r1.md`.

## 1. Sheets bound to what was confirmed
**Before.** After the 15 s pending escape, Cancel closes a sheet whose request is still running.
- A sheet opened next, for another action or row, named the new action but showed the old request's spinner and result.
- After a lit Publish or Approve it could stay open, and on Review the dock state then stuck.
- On the web, a confirm made while the browser reports offline is held by TanStack Query until reconnect. Each mutationFn read the sheet's latest state, so on reconnect it acted on the row opened since, with that sheet's draft. Main had the same flaw.

**Now:**
- **Variables.** Builder study, Review, Disputes, Moderation and Stuck pass their target and fields to `mutate()` as variables. Each mutationFn reads only those.
- **Reopening.** While a request is pending, any action reopens that request's own sheet, from `mutation.variables`, as it was sent (title, row and fields). That sheet takes the result, and no second request can race it.
- **Tests:**
  - Builder study: Close reopens the running Pause's sheet, busy.
  - Stuck, Review, Disputes and Moderation: a confirm is held offline, reopened from another action or row, edited, then reconnected. The request still sends the confirmed values, once.
  - Restoring the old closure-reading mutationFn in Stuck makes its test fail. This was checked locally and is not part of the evidence files.

## 2. Web keyboard focus clear of the header scrim and docks
**Before.** On web, a stack screen's scroll area runs under the opaque header scrim, and every screen's runs under its dock or tab bar. A browser scrolls a focused control into view only when it is outside that area, so Tab could leave focus underneath (WCAG 2.2 SC 2.4.11).

**Now:**
- **The padding.** `Screen` gives its web scroll container `scroll-padding` equal to the room its content already keeps: the header's at the top of stack screens, and the dock's or tab bar's at the bottom.
  - react-native-web passes the key to the DOM unchanged (`webScrollPadding`).
  - Native is unchanged.
- **Multi-line fields.** A browser shows only a focused text box's caret, so on web a multi-line `Field` calls `scrollIntoView({ block: 'nearest' })` when it takes focus. That honours the padding, so its whole box comes clear.
- **The dock frame** gets the testID `screen-dock`.
- **The test.** `e2e/focus-visible.spec.ts` checks both the cause and the effect, in both themes:
  - the scroll container's computed scroll-padding must cover the header scrim and the dock;
  - Tab down New study and Shift+Tab back up must leave every focused control, text boxes included, wholly between the scrim and the dock frame;
  - it looks up the scrim and the dock inside the screen's own ground, and fails if either is missing.
- **Proof the test bites:** with the padding switched off, the test fails in both themes at its first check (scroll-padding-top 0, where 105 px in dark and 97 px in light are needed) (`focus-mutation.txt`).

## Evidence
Windows 11, Node 24.21.0, pnpm 10.32.1. Local paths are shortened, and the emulator's one-time codes are masked.

| Command | File | Result |
|---|---|---|
| `pnpm verify` | `pnpm-verify.txt` | check:secrets passes (600 files); assert-no-secrets, typecheck and lint pass. Root `scripts/*.test.mjs` 33/37: the same 4 POSIX 0600 file-mode checks as in PR #3. |
| `pnpm -r --if-present test` | `pnpm-test.txt` | contracts 15/15; domain 170/170; API 341 passed, 2 skipped, 1 failed (the same Windows path test). |
| `pnpm --filter @pocket-qa/mobile test` | `pnpm-test-mobile.txt` | 42 suites, 989 tests: all pass. |
| Playwright web e2e | `playwright.txt` | 13/13: the 11 from PR #3, plus the focus test in both themes. |
| `pnpm test:emulator` | `firebase-emulator.txt` | Both tests pass. The file's cleanup hits EPERM on Windows, as in PR #3. |
| `pnpm test:e2e:firebase` | `playwright-firebase.txt` | 2/2. |

**The Windows baselines** are the three described in `docs/reviews/lens/candidate.md`, in code this PR doesn't touch. The Playwright runs use the same git-ignored Windows mirror of the repo's configs as PR #3.

## Review
The reviewer was a read-only subagent of the contributor session (Claude Code, `claude-opus-5-5`), not Hamza's `pqa-qa` pane. Its verdict is committed verbatim.

**`verdict-qa-r1.md` (on `7dab6ef`): APPROVE.** Both findings are fixed and it is safe to merge. It found six P3s:
- **Fixed in `fdb92e4`:**
  - 2: the text-box exception was weak and brittle, so multi-line fields now come wholly into view;
  - 3: the test now checks the cause, scopes its lookups, and fails if the scrim or dock is missing;
  - 4: Disputes and Moderation now have binding tests.
- **Not re-reviewed.** `fdb92e4` came after the review. It is covered by the tests and the run above.
- **Open, with reasons:**
  - **1. New study's own dock scrim.** Its veil fades in up to 72 px above the dock frame, more than its 22 px clearance. A control can be fully clear of the frame yet partly under that veil, which still meets SC 2.4.11 at AA.
    - Fixing it means changing New study's layout (a taller clearance or a shorter scrim), so it is left for a design decision.
    - The other docked screens keep their clearance at least as tall as their scrim.
  - **5. Fields stay editable while their request runs** (pre-existing). A reopened sheet starts as sent, but it can drift while the request runs. Only the confirmed values are ever sent, now that the request is bound.
  - **6. Credits' top-up reads the live amount** (pre-existing, outside this PR, test credits only). It needs the same `mutate()` binding.

## Gates and limits
- **Native:** still open from PR #3. Rebuild the dev client, then run the Seeker, Maestro and iOS checks (Hamza).
- **CI:** this repo has none. Everything above ran on one machine, and its outputs are committed here.
