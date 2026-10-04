# pqa-qa verdict r1: builder and admin flows (PR #3, HEAD 75e009a)

I compared every builder and admin file in scope against `origin/main` (9461db5). That covers 8 screens, `src/screens/review/*`, BuilderStudyBudget/Card/Empty, StuckQueue, adminAudit, DecisionBar and their 7 test files, using `git diff`/`git show`, Grep and full reads. I also checked every selector used by the four Playwright specs and the Maestro flows. This review only read code: per the brief, no tests, builds or servers were run, so runtime behaviour is inferred from the code. Data flow is the same as main. The queries, mutations, request bodies, validation limits, query invalidations and navigation targets all match, and evidence playback uses the same playback-token path from PR #2. No P0 or P1 issues. This area is not safe to merge yet because of one P2 (the sheet state on the builder study screen). There are also five P3s.

## Checked
- **Data-flow parity** (each screen's calls compared line by line against main):
  - Studies: `useStudies`/`useFocusRefetch` and both push targets (`app/(builder)/studies.tsx:16-32`).
  - Builder study: the same `ROUTE` map, `setQueryData(['study', id])` and invalidation of `studies`, `credits` and `studyParticipations` (`app/builder/study/[id].tsx:36,71-82`). Rows push `/builder/review/:id` (155, 178).
  - Review: same approve/reject bodies and invalidations (`app/builder/review/[id].tsx:106-118`), same createFinding body and 3/5-character gates (41-48, 78).
  - Admin: resolveDispute `{outcome, note}` (`app/(admin)/disputes.tsx:186-194`), moderateStudy `{action, reason}` (`moderation.tsx:144-154`), adminDecide `{decision, reason}` (`stuck.tsx:29-38`), each with the same `adminDisputes`/`adminStudies`/`adminStuck` and `audit` invalidations.
- **New study:** the body is built the same way as on main (`app/builder/new-study.tsx:65-74`). The only difference: a task that is fading out is left out (same end result). Same `CreateStudyBody.safeParse` + `lintCopy` save gate (75-76, 103). Same `createStudy`, invalidation and `router.replace` (77-83). Every field testID is kept. `new-study.test.tsx:157-179` pins the exact body.
- **Budget:**
  - Reserved, awarded, committed and available come straight from `study.budget`, formatted with `toLocaleString('en-US')` (`src/screens/BuilderStudyBudget.tsx:121-127`, `src/ui/patterns/KeyValue.tsx:28`).
  - The meter and the card's pips are derived as slots and capped (BuilderStudyBudget.tsx:49-57, `src/screens/BuilderStudyCard.tsx:28-31`). No new money or credit values are invented.
  - New-study budget arithmetic is unchanged (new-study.tsx:104).
  - All copy is carried over from main.
- **Review:**
  - Reject needs at least 10 characters (186). Decision states: the dock appears only for `submitted`, the notice only after a decision (`src/screens/review/decision.ts:26-28`). `canAddFinding` matches main (9-11).
  - Evidence uses the same `playbackToken` → `mediaUrl` call (`src/screens/review/EvidenceStrip.tsx:96-99`; compare `src/evidence/EvidenceItem.tsx:13-16`).
  - Dispute card copy is kept (`src/screens/review/ReviewParts.tsx:164-179`).
  - The commit animation on Approve (U7, "Approve and credit…") starts only from `onSuccess` (110-113).
- **Admin:**
  - Dispute note ≥ 5 characters, moderation reason ≥ 5, stuck reason ≥ 10 (disputes.tsx:225, moderation.tsx:193, stuck.tsx:59).
  - Every stuck item, not only the oldest, has its own `stuck-<reason>` node with its own review-work, reject and approve controls (`src/screens/StuckQueue.tsx:138,196-200,217-234,258`).
  - Audit entries keep the raw action key, the reason and the `[stuck: …]` tag, in API order (`src/ui/patterns/Timeline.tsx:171-186,245-272`). The `participation.*` glyph rule matches the API: `apps/api/src/handlers/admin.ts:123` is the only place that writes those entries.
- **Sheets:**
  - Disputes, Moderation and Stuck open clean (the reason, note and verdict are reset and the old error cleared) and keep their title while closing (disputes.tsx:183-204, moderation.tsx:141-143,173-181, stuck.tsx:26-46).
  - Review keeps the sheet's kind after it closes and resets the error when a sheet opens (review/[id].tsx:96-123).
- **Selectors:** every testID and text used by `admin-dispute`, `review-loop`, `remaining-scope` and `maestro/devnet-transfer-unfunded.yaml` on these screens still exists with the same meaning. `account-delete` touches none of them. This includes:
  - `study-*`, `crit-web`, `copy-issue`, `budget-reserved`/`budget-awarded` (exact text), `builder-participation-*`.
  - `review-*`, `evidence-item`/`-view`/`-media`, `finding-*`, `reject-reason`, `confirm-ok`/`-cancel`, `study-action-sheet-error`.
  - `dispute-open`/`-resolve`/`-outcome-overturned`/`-note`/`-resolved`, `moderate-study`, `moderation-reason`, `stuck-*`, `audit-entry`.
  - Pill text, which is still uppercase (`src/ui/status.tsx:110`).
- **Crash hazards:** no raw string outside `<Text>`, no `&&` applied to a number, every hook runs before any early return, and loading data is accessed with optional chaining. Web differs from native only in the sheet's closing animation and in RN Web's `numberOfLines` (findings 1 and 6).

## Findings
1. **[P2] Builder study sheet: a failed action's error reappears, and is announced, in the next sheet; the sheet also goes blank as it closes.** `apps/mobile/app/builder/study/[id].tsx:117`, `:205`, `:211`.
   - **Stale error.** The dock buttons only call `setConfirm(...)` (117-120), and nothing calls `act.reset()`. So after a failed Close (the e2e's dispute-window conflict) or a failed Publish, followed by Cancel, any sheet opened next gets `status: 'error'` from `act.isError` (211-213). ConfirmSheet then renders `SheetFailure` (`src/ui/index.tsx:927`), which announces "Action failed. <old message>" to screen readers when it appears (`src/ui/patterns/DecisionBar.tsx:186-188`). On a Publish sheet it also keeps the commit light switched off (`src/ui/patterns/light.tsx:111`).
   - **Blank sheet while closing.** The title, body, confirm label and `destructive` flag all come from `confirm` (205-208). Cancel, onSuccess and onLeave set `confirm` to null (215, 76, 85) while native plays its 240ms closing animation with the current props (`src/motion/sheet.ts:81-86`). During that animation the title and confirm label are empty, the body disappears, and the rose Close confirm turns into a primary button.
   - **Not a regression, but still in scope.** Both problems already exist on main (`origin/main` same file :64-67, :115-126). But HEAD adds the screen-reader alert, the brief requires both rules, and this PR fixed and tested them on the other four sheets (`__tests__/admin-screens.test.tsx:191-233,313-342,389-423`; review/[id].tsx:96-123). `builder-study.test.tsx` has no equivalent test.
   - **Fix:** keep the last action for the sheet's copy (as `app/(admin)/moderation.tsx:141-143` does), call `act.reset()` when a dock button opens a sheet, and add the two tests.
2. **[P3] Review: a cancelled Reject reason or Approve note pre-fills the next sheet.** `apps/mobile/app/builder/review/[id].tsx:119`. `openSheet` resets the error but not `reason`/`note` (99-100). A cancelled reason of 10+ characters therefore comes back with Reject already enabled (186) — the case `app/(admin)/stuck.tsx:39-41` treats as a bug. It is the same participation, the text is visible in the field, and main behaves the same (:76-77, :136-137). **Fix:** `setReason(''); setNote('')` in `openSheet`.
3. **[P3] Disputes, Moderation and Stuck still change the sheet body as it closes after a success.** `apps/mobile/app/(admin)/disputes.tsx:190`, `moderation.tsx:148`, `stuck.tsx:33` clear the note/reason in onSuccess, as main did. During the native closing animation the field empties and the confirm fades to disabled, even though `open()` already resets both. The tests check only the title and confirm label (`__tests__/admin-screens.test.tsx:409-423`). **Fix:** remove those resets from onSuccess.
4. **[P3] Dock actions stay tappable while the screen shows its error panel.** `apps/mobile/app/builder/study/[id].tsx:97-109`, `apps/mobile/app/builder/review/[id].tsx:124-153`.
   - Both docks are driven by cached `q.data`/`pq.data`. But QueryState shows ErrorState whenever `error` is set, even when cached data exists (`src/ui/index.tsx:586`), and the ConfirmSheet is rendered inside QueryState's children (study 203, review 180).
   - So after a failed background refetch, Close/Publish/Approve/Reject open nothing, and the sheet pops up later once Retry succeeds. One way this happens: the review's `['study']` invalidation (review/[id].tsx:116) refetches the study screen underneath it, and that refetch fails.
   - Main kept the actions inside QueryState (`origin/main` study :62-68, review :133-139).
   - **Fix:** hide the dock while `q.error`/`pq.error` is set, or render the sheet outside QueryState.
5. **[P3] Accessibility: the evidence "View" buttons and the "Decision" heading lost context.** `apps/mobile/src/screens/review/EvidenceStrip.tsx:145`, `apps/mobile/src/ui/patterns/DecisionBar.tsx:57`.
   - Each evidence tile's button is labelled only "View" and now comes before its caption (105-125). With two items, a screen reader announces "View, button" twice before saying which item it is. Main read the heading first (`src/evidence/EvidenceItem.tsx:19-26`).
   - The docked "Decision" title is plain text. Main's Section title had the header role (`origin/main:apps/mobile/app/builder/review/[id].tsx:134`).
   - **Fix:** `accessibilityLabel={`View ${label} ${index + 1}`}`, and `accessibilityRole="header"` on the bar title.
6. **[P3, unverified] The Reserved figure may be cut off on web for large budgets.** `apps/mobile/src/ui/patterns/KeyValue.tsx:62`, `apps/mobile/src/screens/BuilderStudyBudget.tsx:146`. A 44px numeral sits in a fixed 132dp column with `numberOfLines={1}` and relies on `adjustsFontSizeToFit`, which react-native-web ignores. A reserve of 5+ digits (reward can be up to 1,000,000 × 500 slots) may therefore show with an ellipsis in the web preview. Main's figure wrapped freely (`origin/main` study :55). I could not measure this. **Fix:** check at 10,000 and above; if it clips, drop `numberOfLines` on web or use a smaller size.

## Verdict
CHANGES_REQUIRED
