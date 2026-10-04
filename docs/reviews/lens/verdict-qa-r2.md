# pqa-qa verdict r2: the r1 fixes (PR #3, HEAD 058268d)

I read the four r1 verdicts, `git show 4875dbd` and `058268d`, and `git diff 75e009a 058268d` (37 files). I compared every changed kit API with all of its callers on HEAD and on main. I also checked every Playwright, e2e-firebase and Maestro selector that the changed files produce. To confirm how things behave at runtime, I read the installed TanStack Query 5.104.1, react-native-web 0.21.3 and react-native 0.86.3 sources. Tools: `git show/diff/log/grep/ls-tree`, Read and Grep. I ran no build, test or server. Working-tree files changed while I worked (the verification run), so every HEAD citation below comes from the commit objects. The P2 and 17 of the 20 P3s are fixed as the commit says, and leaving the other three open is reasonable. No caller, testID or flow selector broke. The fix adds one P3 edge case (finding 1). Findings 2 and 3 are gaps in tests and records. PR #3 is safe to merge.

## r1 findings
| Verdict | Finding | Status | Evidence |
|---|---|---|---|
| builder/admin 1 (P2) | Builder study sheet re-showed and announced a stale error, and went blank while closing | Fixed | `open()` resets the mutation, and the sheet keeps its last action: `apps/mobile/app/builder/study/[id].tsx:71-73,97-100,220-226`. Tests: `apps/mobile/__tests__/builder-study.test.tsx:313,339`. See new finding 1 |
| auth 1 | U1 never dimmed Sign in's key light | Fixed | `apps/mobile/src/screens/authParts.tsx:126-128` registers `light.u` inside the Ground. The only other registration is `apps/mobile/src/glass/Uplight.tsx:78`. `GroundFade` follows the same pool (`apps/mobile/src/glass/Ground.tsx:192`). Test: `apps/mobile/__tests__/auth-screens.test.tsx:622` |
| auth 2 | A phone keyboard may cover Sign in | Fixed (mitigation) | The Return key (`go`) runs the same guarded `submit()`: `apps/mobile/app/(auth)/sign-in.tsx:254`. Test: `auth-screens.test.tsx:131`. No flow presses Enter there. The phone-browser check is still not done |
| auth 3 | Firebase e2e could not catch a bare verify body | Fixed | `apps/mobile/e2e-firebase/firebase-auth.spec.ts:29-31` |
| tester 1 | During the U4 hold, Submit and Withdraw stayed live and the notes editable | Fixed | `apps/mobile/app/participation/[id].tsx:668,670`. `apps/mobile/src/ui/index.tsx:488`; the only `locked` Field is `participation/[id].tsx:196`. Test: `apps/mobile/__tests__/participation-session.test.tsx:327-329` |
| tester 2 | Withdrawn sessions hid the tasks and notes | Fixed | `apps/mobile/app/participation/[id].tsx:638`. Test: `participation-session.test.tsx:411` |
| tester 3 | Cards hid their facts; inert well; labels on containers with no role | Fixed (native) | Hints: `apps/mobile/src/ui/patterns/StudyCard.tsx:39-41`, `apps/mobile/app/(tester)/work.tsx:63-65`. Well: `apps/mobile/src/ui/patterns/RewardWell.tsx:36`; only those two cards use it. `role="group"`: `apps/mobile/src/ui/patterns/ClipRow.tsx:62`, `RecordControl.tsx:95`. react-native-web 0.21.3 drops `accessibilityHint`, so web screen readers still hear only the label, as on main |
| tester 4 | No native Maestro or Seeker run on a Lens build | Open (accepted) | A verification gap, not a code defect. The selectors and recorder logic are unchanged and covered by Jest, and this checkout has no device. Run `apps/mobile/e2e/maestro/run-native.sh` and both iOS flows before the freeze candidate |
| builder/admin 2 | Review keeps a cancelled reason or note | Open (accepted) | Same participation, the text stays visible in the field, and Reject still needs a press. Main behaves the same |
| builder/admin 3 | Admin sheets changed their body while closing | Fixed | `apps/mobile/app/(admin)/disputes.tsx:189,198-202`, `moderation.tsx:147,173-178`, `stuck.tsx:32,42-46`. Only Stuck is tested: `apps/mobile/__tests__/admin-screens.test.tsx:419-423` |
| builder/admin 4 | Dock actions stayed live behind the error panel | Fixed | `apps/mobile/app/builder/study/[id].tsx:113`, `apps/mobile/app/builder/review/[id].tsx:139`. `dock` is still always passed, so the content never remounts. No test |
| builder/admin 5 | "View" buttons and the "Decision" title lost context | Fixed | `apps/mobile/src/screens/review/EvidenceStrip.tsx:113,149` (the name keeps the visible "View"). `apps/mobile/src/ui/patterns/DecisionBar.tsx:57`, `apps/mobile/src/ui/text.tsx:128`. Tests: `apps/mobile/__tests__/review-screen.test.tsx:189,211` |
| builder/admin 6 | The Reserved figure may be cut off on web | Fixed | `apps/mobile/src/ui/patterns/KeyValue.tsx:64-70,82-90`. The numeral stretches across the well (`apps/mobile/src/screens/BuilderStudyBudget.tsx:147`), so its measured width never depends on its size. 500,000,000 gets 19px. The `budget-reserved` text is unchanged. Glyph widths are estimated, not measured in a browser. Test: `patterns.test.tsx:259` |
| kit 1 | On web, keyboard focus can land under the header scrim or a dock | Open (accepted) | Web only; tab roots already had it on main. It still needs to be recorded (finding 3) |
| kit 2 | The HeaderScrim falls outside the performance budget | Fixed (doc) | `docs/decisions/0006-lens-visual-system.md:69,72-73` |
| kit 3 | The Commit-pass lock had no escape without `onLeave` | Fixed | `apps/mobile/src/ui/index.tsx:857`. Both callers that can reach success pass `onLeave` (`builder/study/[id].tsx:229`, `builder/review/[id].tsx:191`). Test: `apps/mobile/src/ui/__tests__/shared.test.tsx:122` |
| kit 4 | Notice wrapped only a lone string in Text | Fixed | `apps/mobile/src/ui/status.tsx:120-124,149`. All 36 callers still pass one string, one expression or one element. Test: `shared.test.tsx:325`. Children that mix text with `null` or elements still render bare; nothing passes those today |
| kit 5 | No `aria-checked` or `aria-busy` on web | Fixed | `apps/mobile/src/ui/index.tsx:643,694`, `apps/mobile/src/ui/button.tsx:152`; `FocusPressable` passes them to the Pressable. No test |
| kit 6 | The header clip frame cut the back tile's shadow | Fixed | `apps/mobile/src/ui/StackHeader.tsx:125` clips on web only, and the comment is corrected. The native value is pinned at `chrome.test.tsx:202` |
| kit 7 | Dead `useSwapFade`; stale `ScreenSpacer` doc | Fixed | No `useSwapFade` reference is left. `apps/mobile/src/ui/index.tsx:248` |
| kit 8 | ADR 0006 out of date | Fixed | `0006-lens-visual-system.md:59,91,95,97,102,105-109,140` match the code: ErrorState tints `index.tsx:566-576`, the edge docks, the confirm glyph `index.tsx:864`, `glass.lockShade` `index.tsx:501`. One new gap: finding 3 |
| 058268d | Offline e2e: final check scoped to My work | Agree; hides no bug | A tester with no device profile is never eligible (`packages/domain/src/eligibility.ts:5`). So Discover always ends on its own `empty-state` (`apps/mobile/app/(tester)/discover.tsx:125`; default testID at `apps/mobile/src/ui/index.tsx:546`), and its tab scene stays mounted. Main has the same unscoped check. `work-screen` wraps My work's content (`apps/mobile/app/(tester)/work.tsx:27`, `index.tsx:209`). So `apps/mobile/e2e/review-loop.spec.ts:228` checks that the screen that went offline recovered, and Discover's panel can no longer satisfy it, which makes it stricter than before |

## New findings
1. [P3] Opening a sheet while an earlier request still hangs detaches that request. `apps/mobile/app/builder/study/[id].tsx:97-100`; this is new in 4875dbd. Review's `openSheet` (`apps/mobile/app/builder/review/[id].tsx:119-123`) and the admin `open()`s do the same.
   - After the 15 s pending escape (`apps/mobile/src/ui/index.tsx:778,852`), Cancel closes the sheet while the request is still running.
   - The next dock tap calls `act.reset()`. In TanStack Query 5.104.1, `MutationObserver.reset` only detaches the observer, so the new sheet opens idle and can send a second state change in parallel.
   - When the first request lands, its `onSuccess` still runs. `setConfirm(null)` closes whatever sheet is open, and `setQueryData` can overwrite the newer study with the older one.
   - Main reopened the sheet still pending (no reset; `origin/main:apps/mobile/app/builder/study/[id].tsx:64-67,121`).
   - Fix: `if (!act.isPending) act.reset();`, and the same in `openSheet` and the admin `open()`s.
2. [P3] Several fixes are not pinned by a test. `apps/mobile/__tests__/builder-study.test.tsx`, `apps/mobile/__tests__/review-screen.test.tsx`.
   - builder/admin 4 (no dock while the error panel shows) has no test.
   - kit 5's aria props, kit 6's web clip (`chrome.test.tsx:202` pins only the native `visible`) and KeyFigure's web sizing are web-only code paths. Jest runs the native platform, so it never takes them.
   - builder/admin 3 is asserted for Stuck only, and tester 3's `role="group"` is not asserted at all.
   - Fix: add a Builder study case and a Review case with cached data plus `error` that expect no `study-close` and no `review-approve`, and a Playwright check of `aria-checked` on `consent-checkbox`.
3. [P3] Two records do not match the commits.
   - `docs/decisions/0006-lens-visual-system.md:91` still says the kit keeps every exported prop and accessibility prop. But 4875dbd removed `useSwapFade` (exported on main, `origin/main:apps/mobile/src/ui/screen.tsx:125`) and RewardWell's `accessible`/`accessibilityLabel` (`origin/main:apps/mobile/src/ui/patterns/RewardWell.tsx:31-33`). The ADR does not say the reward phrase now lives in the card hint.
   - 4875dbd says the three open items are recorded in `docs/reviews/lens/candidate.md`, and 058268d cites `docs/reviews/lens/offline-test-*.txt`. Neither file is in the tree.
   - Fix: one ADR sentence. Add `candidate.md` with the three open items, and the offline-test output (CLAUDE.md wants command evidence in `docs/verification.md`).

## Verdict
APPROVE
