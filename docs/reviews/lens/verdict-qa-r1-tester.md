# pqa-qa verdict r1: tester flows (PR #3, HEAD 75e009a)

I compared `git diff origin/main HEAD` (main = 9461db5) for Discover, My work, Study detail, the session screen, Credits, Settings and the wallet card. I also checked the patterns those screens render: StudyCard, RewardWell, TaskList, RecordControl, ClipRow, GlideList, BalanceHero, ListRow, EmptyPanel, SectionHeader and Clauses. SlotMeter, Timeline and KeyValue are used only by builder screens, and their diffs add no hazard. The kit parts these screens rely on were in scope too: the Screen dock, StatusPill, Notice, Field, Button and ConfirmSheet. Method: `git diff`, `show`, `log` and `grep` against main and against PR #2's own range (`1b8385c..9461db5`). I read the HEAD sources, the API state rules (`apps/api/src/handlers/participations.ts`), every Maestro flow and helper, and the three Playwright specs. I ran no tests, builds or servers. **Verdict: safe to merge for the tester flows.**
- The data flow and every recording safety rule match main.
- Every native and web selector still exists and means the same thing.
- There are no P0–P2 issues. Four P3s follow; the last one is a device run to do before the freeze candidate.

## Checked
- **Data flow matches main.**
  - Discover (`apps/mobile/app/(tester)/discover.tsx`): `useEligible` and `useFocusRefetch`; navigates to `/study/:id` and `/settings`. The new `device-edit` button goes to the same Settings route as `open-settings`.
  - Study detail (`apps/mobile/app/study/[id].tsx:60-69`): the same `consent` body `{consentVersion, accepted: true}`, the same `eligible` and `participations` invalidations, and the same `router.replace` to the session. The only addition is a motion stamp.
  - My work: `useMyParticipations`; navigates to `/participation/:id` and `/discover`.
  - Credits (`apps/mobile/src/screens/CreditsScreen.tsx:60-116`): the same `topUp` body and `['credits']` invalidation. The 600ms row landing and the U5 memory only change what is shown and when.
  - Settings and wallet: `putDevice`, `exportMe`, `deleteMe`, `walletUnlink`, `linkWalletWithMwa` and `walletCapability` are unchanged.
  - The merge dropped nothing from PR #2: PR #2 touched none of these eight files. `uploadEvidence`, the capability module and TransferCard are main's versions.
- **Session actions** (`apps/mobile/app/participation/[id].tsx:570-609`):
  - Start, submit and withdraw send the same params and bodies, update the same cache, and invalidate `['participations']`. They use the route id that `useParticipation` fetches.
  - Notes (`:175-178`) and the dispute (`:488-495`) are unchanged.
  - Decision, findings and disputes now mount only for decided statuses. Nothing is hidden by this: the API refuses findings before submit (`apps/api/src/handlers/participations.ts:107-108`), and a dispute can only start from a rejection.
- **Recording safety is unchanged.** EvidenceCapture (`participation/[id].tsx:246-370`) is main's `:82-205` line for line, plus a `locked` prop:
  - The recorder appears only after consent and Start. The OS dialog shows on every start. POST_NOTIFICATIONS is required on Android 13+.
  - A decline or a refused permission shows "Nothing was recorded". The system-stop and error listeners are unchanged. Leaving the screen discards and purges.
  - A clip must be kept before it can upload. `uploadKept` reads the live ref, so a removal during an upload wins. Local copies are deleted after upload.
  - ClipRow offers Keep only for `recorded`, and Remove at every point except during the upload (`apps/mobile/src/ui/patterns/ClipRow.tsx:59-60`). Pill labels and tones are main's.
  - Submit stays disabled while anything is pending, including a recording (`participation/[id].tsx:657-667`).
- **Live capture never remounts.**
  - The session always passes the `dock` prop, and Screen chooses its content wrapper by whether that prop is passed (`apps/mobile/src/ui/index.tsx:208`, `participation/[id].tsx:738`).
  - `Arrive` and `useMountedLate` are fixed at mount (`apps/mobile/src/ui/screen.tsx:118-122`). Conditional siblings keep fixed slots.
  - A theme switch remounts only GlassSurface internals, never EvidenceCapture.
- **U4 hold** (`participation/[id].tsx:579-597`): the cache takes the server's answer immediately. The view holds the in-progress session only after a successful submit, which can't happen with anything pending. Timers are cleared on unmount.
- **States and copy.**
  - Loading, error, offline and empty states come through the unchanged QueryState, ErrorState and EmptyState.
  - Every string main showed is kept word for word: notices, sheets, disclaimers, "if approved", "no cash value", "Analysis unavailable…", the wallet text.
  - New lines claim nothing: "Matched to", "Open studies · N", the Discover footer, and the "recording your screen" announcement.
  - There are no claims of earnings, payouts or analysis.
- **Selectors.**
  - Maestro (native only), all present with the same meaning:
    - Join flow: `discover-screen`, the study title tap, `consent-checkbox`, `consent-submit`, `session-start` (now in the dock).
    - Recording: `record-start`, `record-stop`, `segment-recorded`, `segment-keep`, `segment-remove`, `upload-kept`, `uploaded-evidence`, `evidence-error`, `recording-stopped`, `recording-unavailable`, `attach-evidence`.
    - Wallet and account: `wallet-link`, `wallet-address`, `wallet-unlink`, `wallet-error`, `wallet-unavailable`, `delete-account`, `delete-phrase`, `confirm-ok`.
    - Texts: "IN PROGRESS", "LINKED", "NOT LINKED", "Uploaded (1)", "video/mp4", "Recording · video/mp4" (still one line, `participation/[id].tsx:420-422`), "Nothing was recorded", "No evidence uploaded yet", and both capability reasons.
  - Playwright IDs: `study-card-*`, `device-missing`, `reward-disclaimer`, `task-note-0`, `task-note-save-0` ("Saved"), `pending-evidence`, `session-submit`, `awaiting-review`, `approved-notice`, `credit-balance` (exact text at rest), `offline-state`, `retry-button`, `empty-state`, `export-data`, `export-done`.
  - Removed rows stay on screen for 240ms, but their descendants are hidden and take no touches (`apps/mobile/src/ui/patterns/GlideList.tsx:112-123`). The `assertNotVisible` and `toHaveCount(0)` checks therefore still hold.
- **Crash hazards.** No raw text sits outside Text. Notice renders only string children as text (`apps/mobile/src/ui/status.tsx:141`), and every Notice in these screens passes a single string. No hooks are conditional, and the setState-during-render patterns settle. Optional access is used wherever data may be missing.
- **Accessibility.**
  - Buttons have roles and labels (e.g. "Edit device profile"). Headings, the radio group and the checkbox have roles.
  - Touch targets are 48dp, including the compact Edit, Saved and Withdraw.
  - Recording start is announced, leaving rows are hidden, and the dock comes after the content in reading order.
- **Tests.** The six suites cover:
  - every session status, the Start dock, record/keep/upload/remove, U4 and the failure paths;
  - credits landing;
  - the device, wallet and delete states.

## Findings
1. **[P3] During the U4 hold, Submit and Withdraw look enabled and the notes stay editable.** `apps/mobile/app/participation/[id].tsx:667`, `:669`, `:196`; `apps/mobile/src/ui/index.tsx:475-494`.
   - The hold lasts about 1.5s on native (`:60-61`, `:591-592`).
   - Both buttons ignore presses (`locked ? undefined : …`) but are neither disabled nor busy. A screen reader still offers "Submit for review" for a session that is already submitted.
   - `Field locked` only animates the well; the TextInput has no `editable`. Text typed during the hold is silently dropped.
   - Fix: pass `locked={locked}` to both Buttons (the kit's prop that ignores presses and announces busy, `apps/mobile/src/ui/button.tsx:51,67,150`), and set `editable={!locked}` on the TextInput.
2. **[P3] Withdrawn sessions no longer show the tasks or the tester's saved notes.** `apps/mobile/app/participation/[id].tsx:636-648`.
   - HEAD renders only the closed panel, and `apps/mobile/__tests__/participation-session.test.tsx:407-413` asserts that.
   - Main showed the task list with read-only notes for every status (main `apps/mobile/app/participation/[id].tsx:71-72,354`).
   - The change follows the board, as the file comment says (`:40`), but ADR 0006 does not record it.
   - Fix: render `TaskRecap` for `withdrawn` too, or record the removal as a product decision.
3. **[P3] Accessibility: pressable cards hide their facts, and two containers carry stray labels.**
   - VoiceOver hears only "Open study {title}" or "Open session": no reward, no "Not guaranteed", no status, no date. These labels already existed on main (main `apps/mobile/app/(tester)/discover.tsx:40`, `apps/mobile/app/(tester)/work.tsx:25`) and now sit at `apps/mobile/src/ui/patterns/StudyCard.tsx:39` and `apps/mobile/app/(tester)/work.tsx:63`.
   - New in this PR: the `accessible` RewardWell (`apps/mobile/src/ui/patterns/RewardWell.tsx:31`) sits inside those buttons, so on Android it becomes a separate stop that does nothing.
   - `apps/mobile/src/ui/patterns/ClipRow.tsx:62` and `apps/mobile/src/ui/patterns/RecordControl.tsx:95` put `accessibilityLabel` on containers that have no role. On web that becomes an `aria-label` on a plain div, which ARIA 1.2 prohibits. The pills already avoid this under rule C8 (`apps/mobile/src/ui/status.tsx:103-106`).
   - Fix: put the reward, disclaimer, status and date in the Card's new `accessibilityHint` (or build a full label). Drop `accessible` on wells inside pressable cards. Give the two containers a role, or drop their labels.
4. **[P3, unverified] No native test run on a Lens build yet.**
   - The last Android `run-native.sh` pass (10/10) and the iOS `ios-smoke` / `ios-settings` passes ran before the Lens redesign (`docs/verification.md:303-304`). The Lens entry records that no device was attached (`:328`).
   - PR #3 rebuilds the session's native view tree: the Start dock floating over a scroll view wrapped in a BlurTargetView, RecordControl, and ClipRow inside GlideList.
   - Every selector checks out in code. But only Maestro exercises the OS consent dialog, the notification and system stops, the denied notification permission, and leaving while recording. Jest mocks the recorder, and Playwright runs on web, where recording is unavailable.
   - Fix: on a HEAD build, run all 11 flows listed at `apps/mobile/e2e/maestro/run-native.sh:12` plus both iOS flows, and record the output in `docs/verification.md` before the freeze candidate.

## Verdict
APPROVE
