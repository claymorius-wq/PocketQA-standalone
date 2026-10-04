# pqa-qa verdict r3: the r2 fixes (PR #3, HEAD ad99009)

I read `docs/reviews/lens/verdict-qa-r2.md`, `git show ad99009`, `git diff 058268d ad99009` (11 files) and `docs/reviews/lens/candidate.md`. I traced the five guards through every state: idle, failed, succeeded, and pending before and after the 15 s escape. I checked them against the installed TanStack Query 5.104.1 (`node_modules/@tanstack/query-core/src`), react-native-web 0.21.3 and RNTL 14.0.1. Tools: `git show/diff/log/grep/ls-tree/for-each-ref`, Read and Grep. I ran no build, test or server. The verification run rewrote `docs/reviews/lens/` while I worked (`candidate.md` at 13:28). So I cite commit objects, and those files as they stood at 13:28. Its outputs show ad99009 passing Jest 983/983 and Playwright 11/11. All three r2 findings are fixed. Each new test would fail if its fix were reverted (traced, not run). The guard swaps r2's race for main's behaviour. Finding 1 lists what that leaves: all P3, and one part is PR #3's own. `candidate.md` has a few errors in its records. PR #3 is safe to merge.

## r2 findings
| Finding | Status | Evidence |
|---|---|---|
| r2 1: opening a sheet detached a running request | Fixed | Guards: `apps/mobile/app/builder/study/[id].tsx:100`, `apps/mobile/app/builder/review/[id].tsx:121`, `apps/mobile/app/(admin)/disputes.tsx:202`, `moderation.tsx:178`, `stuck.tsx:45`. Idle, failed and succeeded mutations still reset. So no settled failure reaches a new sheet, and the r1 P2 stays fixed. Pending before the escape: `open()` cannot run, because the Modal covers the dock. After the escape, the reopened sheet is busy: the confirm is disabled, and Cancel locks again for 15 s, as on main. Only one request exists. `apps/mobile/__tests__/builder-study.test.tsx:354-373` fails without the guard: `reset()` leaves the confirm idle (line 371). The other four guards are untested. What remains is finding 1 |
| r2 2: fixes without tests | Fixed | No dock under the error panel: `builder-study.test.tsx:345-352` (`study/[id].tsx:115`) and `apps/mobile/__tests__/review-screen.test.tsx:203-209` (DockSlot never mounts, `review/[id].tsx:140`). Note and reason kept after success: `apps/mobile/__tests__/admin-screens.test.tsx:169,288`. The sheet is still in its exit after 10 ms, so these fail if the clears 4875dbd removed come back. Group role: `apps/mobile/src/ui/patterns/__tests__/patterns.test.tsx:355-356,380-381`. `aria-checked`: `apps/mobile/e2e/review-loop.spec.ts:97,99`; react-native-web maps `aria-checked`, never `accessibilityState` (`node_modules/react-native-web/dist/modules/createDOMProps/index.js:219-221`). The query mock (`builder-study.test.tsx:52-55`, `review-screen.test.tsx:58-61`) supplies what QueryState and the screens read: `isLoading` false, `error`, cached `data` and `refetch` (`apps/mobile/src/ui/index.tsx:591-593`). Real 5.104.1 also sets `status: 'error'`, `isSuccess: false` and `isRefetchError: true` (`query.ts:864-878`, `queryObserver.ts:686-717`), but nothing here reads them. Still untested (web-only, outside r2's fix): `aria-busy`, the web header clip, KeyFigure's web sizing |
| r2 3: records | Fixed (ADR); records not yet committed | `docs/decisions/0006-lens-visual-system.md:91-93` is accurate. `useSwapFade` is the only kit export removed. Its one caller on main, StatusPill (`origin/main:apps/mobile/src/ui/status.tsx:55`), has its own crossfade since 0e5b1d0. RewardWell sets no accessibility props. Both of its callers are pressable cards whose hint uses `rewardPhrase()`: `apps/mobile/src/ui/patterns/StudyCard.tsx:39-41`, `apps/mobile/app/(tester)/work.tsx:63-65`. `candidate.md` (with the three open items) and `offline-test-*.txt` exist only untracked in `docs/reviews/lens/`. `docs/verification.md` has no PR #3 entry |

## candidate.md
Accurate (the version rewritten at 13:28):
- the commits and the scope: `git diff --stat origin/main ad99009 -- . ':!apps/mobile' ':!docs'` is empty, and in the five app folders only WalletSection changes;
- the merge: 3f02178's tree equals `lens-on-auth`;
- the bug on main, the r1 table, the fixes and the open items;
- every evidence count, and the Gates.

Inaccurate:
- Line 3: three outputs did not run on ad99009, not two: `offline-test-75e009a.txt`, `offline-test-origin-main.txt` and `windows-baselines-origin-main.txt`.
- Line 41: `windows-baselines-origin-main.txt` ran on the clone's stale local `main` (d358a05, before PR #1 and PR #2), not on 9461db5. It has baselines 1 and 2 only. "All three fail the same way on main" rests on the empty `scripts apps/api packages` diff, not on a run on main.
- Lines 106-113: ad99009 does not fix the second half of r2 finding 3 (the missing records). That half arrives with this folder, and `docs/verification.md` still needs a PR #3 entry that links these outputs. "A test pins this" covers Builder study only.
- Line 115: the `%R3%` placeholder must be filled before the commit.

## New findings
1. [P3] After the 15 s escape, a sheet opened for another action or row stays bound to the old request. `apps/mobile/app/builder/review/[id].tsx:109-124`, `apps/mobile/app/(admin)/disputes.tsx:187,198-204`, `moderation.tsx:145,173-180`, `stuck.tsx:30,42-47`.
   - All five screens: the new sheet names the action or row just tapped, but it shows the old request's spinner and then that request's result.
     - A failure shows under the new title, for example Pause's error under "Close this study?".
     - A success closes the sheet, except after a lit Publish or Approve (next bullet).
     - The admin `open()`s also clear the note, outcome and reason, even when the same row is reopened. So the busy sheet does not show what was sent. Main kept those fields.
   - Lit Publish or Approve (PR #3's own, since 0e5b1d0):
     - On success, `onSuccess` sets `passing` instead of closing the sheet (`study/[id].tsx:83-84`, `review/[id].tsx:112-113`).
     - A sheet of the other kind gets no commit `status`, so `onLeave` never fires (`apps/mobile/src/ui/index.tsx:862`, `apps/mobile/src/ui/patterns/light.tsx:127-133`).
     - Builder study: the Close sheet just stays open, and the Budget card's landing animation is lost.
     - Review: the Reject sheet stays open on an approved participation. After Cancel, the Decision dock stays, and the Decision notice and TransferCard stay hidden (`apps/mobile/src/screens/review/decision.ts:26-28`, `review/[id].tsx:179`). This lasts until the screen remounts, or until Approve is tapped, which plays the Commit pass without sending a request. A Reject gets a 409.
   - Admin screens, web only:
     - Each `mutationFn` reads `target` and the fields from the latest render, and a pending mutation takes each new render's options (`mutationObserver.ts:122-123`).
     - A confirm pressed while the browser reports offline is paused, and its function runs only on reconnect (`mutation.ts:296-301`, `retryer.ts:249-255`). Native never pauses (`onlineManager.ts:24-31`).
     - On reconnect it acts on the row opened since, with that sheet's draft. It succeeds once the draft meets the server minimum (`packages/contracts/src/index.ts:337,350-353,394-397`).
     - In 058268d the reset hid this: the paused request failed on a null `target`. Main does the same and is worse, because it kept the old row's note, outcome or reason.
   - Fix: while a request is pending, reopen the sheet on that request's own action or row (`act.variables`, `decide.variables`), and leave its fields alone. Pass the admin target and fields as `mutate()` variables, so each request is bound to what was confirmed.

## Verdict
APPROVE
