# Candidate: integrated release candidate (main `4bd307a` merged, plus increment 5)

**Branch:** `feat/production-readiness`.
- **Reviewed through:** `06c09b3` (`freeze-verdict-qa-r1` APPROVE).
- **New since then:**
  1. **Merge commit `94774d1`.** It brings in `origin/main` `4bd307a` (Lens UI, PRs #3 and #4), with the production behaviour re-applied on Lens screens. This commit is not reviewed yet.
  2. **Increment 5** (staged, uncommitted; `git diff --cached`).

**Parent instructions in force (2026-10-04):**
- Preserve Lens.
- No object deletion, lifecycle rules, paid services or payments, and no risk acceptance implied.
- The origin is confirmed as `https://pocketqa.optijara.ai`.
- Don't touch the root checkout, live processes or preview data, and don't change fixtures. The parent fixed the preview fixture itself.

## 1. Merge `94774d1` (please review `06c09b3..94774d1`)
Conflicts were resolved by taking main's Lens version of each file and re-applying the production behaviour:

| File | Re-applied |
|---|---|
| `app/(auth)/sign-in.tsx` | All of the following: <ul><li>hero copy without test credits when they're off;</li><li>"Forgot password?" and "Resend verification email" in firebase mode;</li><li>the unverified Firebase session discarded on unmount (refs);</li><li>one "Continue with &lt;wallet&gt;" per Wallet Standard wallet;</li><li>Android MWA sign-in;</li><li>"Can't reach Pocket QA" for a production build without `/config`.</li></ul> The Lens U1 and `runPlain` paths are kept, and the new actions use `runPlain`, so they're never lit. |
| `src/screens/CreditsScreen.tsx` | A funding-unavailable notice instead of the top-up card when `features.testCredits` is off. New test. |
| `app/builder/review/[id].tsx` and `app/participation/[id].tsx` | Transfer cards only when `features.devnetTransfers` is on. |
| `src/wallet/WalletSection.tsx` | One "Link &lt;wallet&gt;" per installed wallet, inside Lens's `LateEnter` block. |
| `docs/progress.md` and `docs/verification.md` | Both histories kept. |

Main's new screen tests mock `useSession`, so their mocks now carry the development feature flags and the new session fields.

## 2. Increment 5 (staged)

### Lens follow-up UI defects (`docs/reviews/lens-followups/verdict-qa-r1.md`, P3s 1–6)
- **P3-6.** The Credits top-up is bound to the amount that was tapped (`mutate(amount)`). The amount control shows the in-flight amount and ignores changes until the request settles; this is set synchronously at the tap, because TanStack's `isPending` renders a tick later. The test holds the request, picks another amount, then checks the selection and the single call with the original amount.
- **P3-5.** The sheet fields are `locked` while their request is pending:
  - Stuck reason;
  - Moderation reason;
  - Dispute note, plus the outcome segment ignores changes;
  - Review reject reason and approve note.
  
  The held-offline tests now assert `editable=false` and the confirmed text after typing.
- **P3-1.** `Screen` gains `focusFloor`, which applies on web only. It sets the least scroll-padding-bottom, and on web also the least content bottom room, so the last controls can scroll clear. Native layout is unchanged. New study passes its scrim height (200) and gives its dock scrim `testID="dock-scrim"`. The focus spec measures the bottom bound at `min(dock top, scrim top)` and fails if the scrim is missing.
  - **Red:** with `focusFloor={0}`, both themes fail "scroll-padding-bottom covers the dock and its scrim" (expected ≥ 199).
  - **Green:** both themes pass. An intermediate green failure, with the consent box under the scrim because the content room was too short, is what led to the web content room change.
- **P3-2, P3-3 and P3-4** were already fixed on main (`fdb92e4`, the existing tests for the binding of disputes and moderation).

### Account deletion follow-ups (inc4 review P3-1)
- **`deleteMe`** writes a fixed-text `user.deleted` audit row in the same transaction, after the redaction step: actor and target are the user, and the reason is `[account deleted by its owner]`. Covered by a test.
- **`db:deleted-since --pre-restore <file>`** (`deletedSince` in `backup.ts`) opens both files read-only. It lists users deleted in the pre-restore database who are active again in the restored one. Test: deleted before the backup gives nothing; deleted after it gives that user.
- Runbook §5 already says to delete these accounts again before reopening.

### Exact-origin CORS (ledger S3)
- `src/storage/cors.ts`:
  - `corsRules(origin)` builds one rule: the exact https public origin, PUT, `content-type`, max age 3600.
  - `planCors` returns `create`, `same` or `conflict`, and never overwrites other rules.
- `scripts/r2-cors.ts` (`r2:cors`): dry run by default. The bucket is pinned to `R2_BUCKETS`, credentials come from the environment and are never printed, and it reads back after `--apply`.
- Tests: `test/cors.test.ts`.
- **Live dry run (read-only):** `bucket pocketqa-evidence: current CORS (none) → plan: create`.
- **Apply after this review.** It's authorized by the parent's relay ("configure … pocketqa-evidence bucket non-destructively, including exact-origin CORS"), and the origin is confirmed.

### Docs
The ledger, access actions and status block are updated, with Firebase probed at 13:01:31Z (`CONFIGURATION_NOT_FOUND`) and no dedicated credentials present.

## 3. Native defects found by the first native run of the Lens UI (all pre-existing on main `4bd307a`)
Main's Lens candidates list "Native: still open". This branch's emulator and simulator runs found the following and fixed each at its root. Every Maestro assertion is unchanged; extra waits I added while diagnosing were reverted, and the original flows pass.

| # | Symptom | Root cause | Fix | Regression guard |
|---|---|---|---|---|
| N-1 | Android crash on starting a recording: `ReferenceError: Property 'CORE_IDLE_OPACITY' doesn't exist` | The `liveLevels` worklet took `coreIdle = CORE_IDLE_OPACITY` as a default parameter. The worklet transform doesn't capture default initialisers, and jest runs worklets as plain JS. | The default moves into the body (`src/motion/BreathingCore.tsx`). | `__tests__/worklets.test.ts`: a static check that no worklet has a default parameter. It fails on the old file. |
| N-2 | Android crash on sign-out and account deletion: `Maximum update depth exceeded`. Symbolicated with the release Hermes map: `useSyncState` in `createNativeStackNavigator`. | The root layout swapped its `Stack` for `<Redirect href="/sign-in">` while `RoleTabs` redirected a signed-out user to `/`. The two guards looped in expo-router's state sync. | The root navigator stays mounted, and every signed-out redirect goes to `/sign-in` (`app/_layout.tsx`, `src/screens/TabsLayout.tsx`). | `__tests__/signed-out-navigation.test.tsx`: three tests, failing on the old code. New Maestro `sign-out.yaml`, added to `run-native.sh`. `sheet-keyboard.yaml` (account deletion) passes. |
| N-3 | "Nothing was recorded" after declining the capture dialog was never visible (`record-decline`) | On the Lens layout the evidence error rendered below the record card, off-screen. | The error renders above the recorder (`app/participation/[id].tsx`). | `record-decline.yaml` is unchanged and passes. |
| N-4 | iOS: the Sign-in dock (riding the keyboard) covered the password field, so it couldn't be tapped (`ios-smoke`, `ios-settings`) | iOS doesn't resize the window for the keyboard, so the content couldn't scroll clear of a riding dock. | `Screen`'s ScrollView uses `automaticallyAdjustKeyboardInsets`, and Sign in scrolls to its end when the keyboard shows. | Both iOS flows are unchanged: they failed on `main.jsbundle 09092f15…` and pass on `a9f23a2f…`. |

## 4. pqa-qa interim API review fixes (`rc-inc5-api-review-qa.md`)
- **P2-1 (fixed, verified by pqa-qa r2).** `restoreDb` moves the database aside with SQLite's sidecar names (`<aside>-wal`, `<aside>-shm`) and checkpoints the kept copy. A crash test runs a child process that deletes an account and exits without closing: `deletedSince` still finds it.
- **P2-2 (fixed).** If the kept copy can't be opened (a corrupt live DB), the restore keeps the trio as it was, completes, and returns a warning, which the CLI prints. `db:restore` and `db:deleted-since` print clean errors, not stack traces. The API refuses to start when only `.pre-restore-*` copies exist (`unfinishedRestore`). Tests: a corrupt 8 KiB live DB is replaced and kept byte-for-byte, and the startup guard.
- **P3-1:** runbook — compare against the original pre-restore file when restores repeat.
- **P3-2** (an operator `db:redelete`): recorded as a follow-up of the A5 deletion decision. Production can't start before A5.

## 5. CORS applied (authorized after pqa-qa's no-defect review of the tool)
- The tool was unchanged since that review. sha256: `r2-cors.ts 91183774…`, `cors.ts 4fc50c07…`.
- `r2:cors --origin https://pocketqa.optijara.ai --apply` against `pocketqa-evidence` only:
  - before: (none);
  - plan: create;
  - readback: matches.
- Preflight probes (`r2-cors-apply.txt`):
  - PUT from the origin: 204, allow-origin set;
  - PUT from `https://evil.example`: 403;
  - GET: 403.
- No object was read, written or deleted.

## Evidence
All on the final tree. "Emulator", "simulator" and "mock wallet" mean exactly that; nothing here ran on a physical device or with a real wallet.

| Check | Result | File |
|---|---|---|
| `pnpm verify` (Node 24.21.0) | EXIT=0. Secrets scan: 710 files, then 726 after the evidence was added. Test counts: scripts 47, contracts 17, domain 170, API 376 plus 2 skipped, mobile 1018 | `rc-pnpm-verify.txt` |
| Playwright (`apps/mobile`, local API, Wallet Standard **test** wallets) | 14/14, including the two-wallet chooser and the focus spec (dark and light) | `rc-playwright.txt` |
| Focus spec red/green (P3-1) | red: `focusFloor={0}` gives 2 failed on scroll-padding; green: 2 passed | (run log in the candidate text above) |
| `pnpm test:e2e:firebase` (Auth emulator `demo-pocketqa`) | 4/4 | `rc-e2e-firebase.txt` |
| Production web export (`PROD_API_URL=/api`) | EXIT=0; secret check 0; no loopback origin and no demo account | `rc-prod-web-export.txt` |
| **Android EMULATOR** `run-native.sh` (12 flows) on final APK sha256 `6f9208cd3889ccb2448dd75ddf2932a87d2d3504a670968412236ad6b0eb3001` | 12/12 EXIT=0; `active_projections=0` after each; the devnet transfer stays `awaiting_signature signature=null`; **0** Pocket QA lines in the crash buffer | `rc-native-suite/` (summary plus JUnit) |
| **Android EMULATOR, Solana MOCK MWA wallet:** `wallet-login-mwa` and `wallet-login-mwa-decline` (same APK) | both MAESTRO_EXIT=0; no crashes; test AVD PIN redacted | `rc-native-wallet-login-mwa*/` |
| **Android EMULATOR:** `firebase-persistence` (Auth emulator; same APK) | MAESTRO_EXIT=0: the session survives force-stop and relaunch | `rc-native-firebase-persistence/` |
| **iOS SIMULATOR** (iPhone 17 Pro, iOS 26.4, Release, ad-hoc signed): `ios-smoke` and `ios-settings` on `main.jsbundle` `a9f23a2f…` | both MAESTRO_EXIT=0. The earlier build `09092f15…` failed both (N-4) | `rc-ios-*/` |
| Earlier Android runs (history) | first run: 8/11 failed (N-1 to N-3, partly under xcodebuild CPU load); then fixed | `docs/verification.md` |

Evidence hygiene:
- seeded test passwords are redacted in the Maestro command logs (`<redacted>`);
- the iOS XCTest runner logs were dropped;
- the AVD PIN occurs 0 times.

## Still open (real providers, hardware, business): unchanged
- **Firebase Auth** is not initialised (probed 13:01:31Z).
- **No dedicated service account and no bucket-scoped R2 token** (A1, A2, A3).
- **Hamza's decisions:** the deletion policy (A5), funding (A9) and the wallet-risk acceptance (A8).
- **Not run on real hardware or wallets:** a physical device, a real browser wallet or a real MWA wallet, and release signing.

