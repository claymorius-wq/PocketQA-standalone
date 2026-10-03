# Freeze candidate: remaining local scope

**Branch:** `feat/remaining-scope` (uncommitted until review). **Base:** `65d66de`. **Author:** lead (solo, claude-opus-5-5). **Reviewer:** `pqa-qa` (read-only).

## Scope (Hamza's request, 2026-10-03)

1. **Payment/currency copy rules scoped to reviewer text.**
   - `lintCopy(text, scope)` and `assertCleanCopy(fields, scope)` now take a scope.
   - `'study'` (builder study content) may describe the app under test: "Buy the $5 item", "Send 0.1 SOL on devnet" and "Verify the payment is successful" are allowed. It still bans earnings promises, fake-AI claims and money aimed at testers (payouts, amounts tied to testers or rewards); see item 6 and the r2 follow-up `docs/reviews/r2-p3/`.
   - `'reviewer'` is the default. It covers approve/reject notes, findings, dispute resolutions, admin decisions, and every UI string, and still bans `paid`/`payout`, currency amounts, "…to your wallet" and "payment complete".
   - Latent bug fixed: `new-study.tsx` called `.flatMap(lintCopy)`, which passed the array index as the second argument.
2. **Builder view of disputes on their own studies.**
   - `GET /studies/:id/disputes`: study owner only, everyone else gets 404, testers get 403.
   - App: a Disputes section on the builder's study page, plus a dispute card on the review page.
3. **Admin resolution of stuck submissions, audited.**
   - Domain `stuckReason`: a submission is stuck when its builder is suspended or deleted, or it has waited ≥ `STUCK_AFTER_DAYS` (7).
   - `GET /admin/stuck` lists them. `POST /admin/participations/:id/decide {decision, reason ≥10}` is admin only and **only for stuck work** (409 otherwise).
   - The reason is copy-checked (reviewer scope).
   - An approval credits once through the same ledger path as a builder approval, so the budget can't go negative and the unique index blocks a second credit.
   - The audit entry is `participation.approve|reject` with the reason plus `[stuck: …]`.
   - App: a new admin **Stuck** tab with approve/reject, a mandatory reason, and in-sheet errors.
4. **Devnet demo transfer screen.**
   - API: `GET /participations/:id/devnet-transfers` (party only; pending items are re-verified on read) and `GET /devnet/transfers/:id/blockhash` (owner only; genesis-checked, from devnet).
   - Domain: `buildDevnetTransferTx`, a hand-built unsigned legacy System transfer. The byte layout is pinned by decoding it with `@solana/kit` 7.1.1.
   - App, `TransferCard` on the builder review page and the tester session:
     - **awaiting signature**: "Nothing has been sent yet". On Android: "Sign with devnet wallet". On web: "needs the Android app".
     - **pending**: "not confirmed yet", polled every 4 s.
     - **confirmed on devnet**: shown only after server verification, with an explorer link.
     - **failed**: with the server's reason.
     - **expired**.
   - It never says "paid". It is labeled "Devnet only · no real value · not a reward".
   - Android signing (`sendTransfer.android.ts`) uses one MWA session. It refuses a wallet account that isn't the linked sender, calls `signAndSendTransactions`, and reports the signature. The outcome is decided by the server only.
   - MWA errors `-2`/`-4` read "could not send… Nothing was sent".

5. **Bugs found by the iOS simulator run, fixed on this branch.**
   - **iOS crash (P1, introduced here, plus the same latent bug from Phases 5-6).**
     - Cause: Metro resolves `*.native.ts` on iOS as well as Android. `sendTransfer.native.ts` and `link.native.ts` import the MWA protocol, whose native module exists only on Android. When the module loads it calls `TurboModuleRegistry.getEnforcing('SolanaMobileWalletAdapter')`, which throws a fatal error.
     - Simulator log, verbatim: `Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'SolanaMobileWalletAdapter' could not be found.`
     - It crashed the app when the session screen opened right after "Consent and join", because the session screen now renders `TransferCard`.
     - Fix: rename both files to `*.android.ts`. iOS and web fall back to `link.ts` / `sendTransfer.ts`, which say "Android only" and never pretend to sign.
     - Guard: `__tests__/platform-modules.test.ts` requires every importer of the MWA package to be `*.android.ts(x)`. It ran red listing both files, then green.
     - **Settings crash, reproduced separately.** The fixed tree was rebuilt with only `link.android.ts` renamed back to `link.native.ts`. The flow `ios-settings.yaml` (sign in, then tap Settings) failed.
       - Settings was tapped at 02:52:31.8, and the simulator log shows the same `Terminating app … 'SolanaMobileWalletAdapter' could not be found` at 02:52:32.735. The screenshot shows the home screen.
       - Files: `ios/ios-settings-RED-old-naming.junit.xml`, `ios/ios-settings-RED-crash.txt`, `ios/ios-settings-RED-app-terminated.png`.
       - After restoring `link.android.ts` and rebuilding, `[Passed] ios-settings (19s)` (`ios/ios-settings.junit.xml`, `ios/ios-settings-regression.png`).
   - **iOS session survived reinstall (privacy).**
     - The iOS keychain outlives uninstall, so a reinstalled app silently signed in as its previous user.
     - Fix: `src/auth/restore.ts` keeps an install marker in app storage, which is wiped with the app. If the marker is missing, any leftover keychain session is dropped.
     - Tests: `__tests__/session-restore.test.ts`, red (module missing) then green.
   - **iOS back button named the route group.** It read "(tester)", both visibly and to VoiceOver.
     - Fix: `headerBackButtonDisplayMode: 'minimal'` plus `headerBackTitle: 'Back'` in the root stack.
     - The Maestro assertion `assertNotVisible ".*\(tester\).*"` failed on the old build (`.results/ios-red`). With only `minimal`, the label was hidden but its accessibility text was still "(tester)", so the assertion still failed. It passes with both settings.
   - **The sign-in and sign-up screens show the real error message** instead of a generic "Sign-in failed." This was needed to diagnose the unsigned iOS build.

6. **Review round 1 fixes** (`verdict-qa-r1.md`: CHANGES_REQUIRED, 1×P2 and 6×P3; all addressed).
   - **P2: study text could promise real money to testers.**
     - The study scope now also bans:
       - `payout` (negations allowed);
       - `money-to-testers`: an amount in the same clause as "per/each tester|participant|session|…" or "testers/you (will) get|receive|earn|be paid…";
       - `reward-amount`: an amount in the same clause as bonus|reward|compensation|stipend|incentive|prize.
     - Prices, "0.1 SOL on devnet", "paid plan" and "payment is successful" are still allowed.
     - Tests, red then green:
       - domain `copy.test.ts`: 8 tester-money phrases blocked, 5 app-describing phrases allowed;
       - API `review-fixes.test.ts`: `POST /studies` returns 400 for the reviewer's three examples.
     - Mutations, each caught:
       - M15: drop `money-to-testers`;
       - M16: drop `reward-amount`;
       - M17: drop the study `payout` check;
       - M18: unbounded proximity. M18 first survived, so a different-sentence allow case was added, and it now fails.
   - **P3: misleading "expired" text and a lost signature.**
     - The expired copy now reads "No signature was reported in time…".
     - Reporting the signature is retried (`src/wallet/reportSignature.ts`). If it finally fails, a `SentNotRecordedError` names the signature and says to check the explorer before starting another transfer, and the notice is titled "Sent, not recorded" instead of "Not sent".
     - Test: `__tests__/report-signature.test.ts` (red, then green).
   - **P3: admins couldn't see the evidence.**
     - `StuckSubmission.tasks` is an additive v0.3.0 field.
     - The Stuck tab has a "Review work" section with task text, notes and evidence playback, using the shared `src/evidence/EvidenceItem.tsx`.
     - API test: the admin gets the tasks, lists the evidence and gets a playback token (red, then green). The Playwright stuck test opens the review section before deciding.
     - Mutation M20 (empty tasks) is caught.
   - **P3: deletion kept the decision text.**
     - Account deletion also redacts audit reasons on the tester's participations and disputes.
     - ADR 0002 is updated. API test red, then green; mutation M19 is caught.
   - **P3: handoff push.** The token is now set on the push command line.
   - **P3: narrow guard.** The guard now matches the package name in any quotes (import, require, `import()`, re-export). Probe M21, a double-quoted `require`, is caught.
   - **P3: doc inconsistencies** fixed: `sendTransfer.android.ts`, and one current APK in `progress.md`.

Contract v0.3.0 is additive (`docs/decisions/contract-changes.md`).

## Evidence (actual output in this folder)

- `pnpm verify` on the r2 frozen tree, EXIT=0 (`pnpm-verify.txt`): secrets 338 files clean, contracts 14, domain 168, api 271, mobile 124.
- **API tests (test-first):** `apps/api/test/remaining-scope.test.ts` ran **red** before the handlers existed (`5 failed`); the role-guard case already passed because the route table guards first. They now pass. The authz matrix's coverage guard failed until the 4 new owner-scoped routes were added to it.
- **Mutation checks** (each reverted afterwards): every one fails tests.

  | Mutation | Failing tests |
  |---|---|
  | M9: admin may decide non-stuck work | 1 |
  | M10: no copy check on the admin reason | 1 |
  | M11: decision not audited | 1 |
  | M12: study disputes without ownership | 2 |
  | M13: transfer list without party check | 3 |
  | M14: study scope as strict as reviewer | 1 |

- **Domain:** `copy.test.ts` (scopes, red before the change: `2 failed`), `stuck.test.ts`, `transferTx.test.ts` (red before the module existed). Disclosure: `stuck.ts` was written alongside its tests, not strictly after a red run.
- **Mobile jest:** each of these ran red, then green:
  - `wallet-errors.test.ts`: send-failure mapping (red: `1 failed`).
  - `session-restore.test.ts`: module missing.
  - `platform-modules.test.ts`: listed both `.native.ts` MWA files.
- **Web E2E** (rerun on the r2 tree): `npx playwright test` gives **8 passed (45.9s)**. The admin stuck test now opens "Review work" first (`admin-stuck-review-work.png`). (`../remaining-scope-playwright.txt`), including the new `e2e/remaining-scope.spec.ts`:
  - transfer awaiting (web notice), then pending, then **confirmed** (builder and tester views), then a mismatched transaction shows **failed** with the server reason and a retry;
  - builder dispute view (study page and review page);
  - admin Stuck tab: builder suspended, the item listed, a too-short reason disabled, a payment-wording reason rejected in the sheet, approve, the item gone, audit shows `participation.approve … [stuck: builder_inactive]`, tester balance 50.
  - Screenshots: `docs/reviews/remaining-scope/*.png`.
- **The chain in web E2E is a TEST DOUBLE.** `apps/mobile/e2e/fake-devnet-rpc.mjs` is a loopback JSON-RPC that returns devnet's genesis hash and transactions the test registers. It shows the UI renders the server's verdict honestly. It is **not** evidence of a real devnet transfer.
- **Native, Android 16 emulator plus Solana Mobile mock wallet:**
  - **r2 frozen-candidate APK (current):** `apps/mobile/artifacts/pocketqa-release-e758f321.apk`, sha256 `e758f321ba21615b9cc92bdaf00bebae9ea72493d033f6f06fe6139c7ec90198`, 51,026,792 bytes, built from the tree with all round-1 fixes.
    - **10/10 flows pass (run `20261003-030814`):** every flow EXIT=0 with `active_projections=0`, and the transfer is `awaiting_signature signature=null`. Evidence: `native/run-20261003-030814/`.
    - The API serving it started at 03:08:11. The only later writes to served sources were the M19/M20 mutation restores (03:10), each verified byte-identical with `cmp`.
  - **r1 candidate APK (superseded):** `apps/mobile/artifacts/pocketqa-release-85ae621a.apk`, sha256 `85ae621a1d855651c2babca12e4d34fed304cdc063938bc8eafbf6109c860d04`, 51,022,844 bytes. It is built from the final JS, including the `.android.ts` rename, the install-aware session restore and the back title.
  - **All 10 flows pass on it (run `20261003-024918`):** every flow EXIT=0 with `active_projections=0`, and the server shows the transfer as `awaiting_signature signature=null`. Evidence: `native/run-20261003-024918/` (summary, 10 JUnit files with `failures="0"`, 3 transfer screenshots).
    - `wallet-link` passing on this APK proves the renamed `link.android.ts` still resolves on Android.
    - The local API serving this run was started at 02:05. The only later writes to API and domain sources were the mutation-check script restoring each file (at 02:21), and no Edit, Write or other shell command touched them. So that server ran the current API code.
  - Earlier APK `4509aed9…` (runs `20261003-020909` and `-021954`): the first evidence, kept in `native/`.
  - New flow `devnet-transfer-unfunded`:
    - The builder links a fresh mock wallet, deep-links to the review screen, starts a transfer and taps Sign.
    - The wallet shows "Pocket QA is requesting transaction(s)", and the tester approves.
    - The wallet **signed and submitted to real devnet**. Wallet log: `Sending transactions to https://api.devnet.solana.com` and `Failed sending transaction, response code=-32002`, consistent with an unfunded fee payer.
    - The wallet returns MWA `-2`. The app shows "could not send… Nothing was sent", the state stays **AWAITING SIGNATURE**, and "CONFIRMED ON DEVNET" is absent.
    - The server records `awaiting_signature signature=null`.
  - Evidence: `native/run-20261003-024918/`, plus the first run's `native/summary.txt`, `native/junit/` and `native/*.png`.

## Blocked / not done (truthful)

- **A real confirmed devnet transfer is BLOCKED on funding.** `requestAirdrop` on `https://api.devnet.solana.com` returned `-32603 Internal error`, then `429 "You've either reached your airdrop limit today or the airdrop faucet has run dry"`. The alternative (faucet.solana.com) needs an external-account login, which I won't use.
- The real device and the real production wallet are still unavailable.
- iOS: only the **simulator** has run, with graceful degradation. Recording other apps and MWA are Android-only by design. No real iPhone was used, and a real-device run would need an Apple signing identity.
- **The preserved APK** `apps/mobile/artifacts/pocketqa-release-82f214ec.apk` is the build that passed the earlier 9 flows. The current tested candidate APK is `pocketqa-release-e758f321.apk` (10/10, r2). `85ae621a` passed 10/10 on the r1 tree and is superseded. Any later change needs another native revalidation.

## iOS simulator: feasible locally, no paid services

- **Toolchain:** Xcode 26.4, iOS 26.4 simulator runtime, iPhone 17 simulator (`4EE9659B-…`), CocoaPods 1.16.2, Maestro 2.6.0. No Apple account or paid membership is needed.
- **Build:**
  ```
  cd apps/mobile/ios && xcodebuild -workspace PocketQA.xcworkspace -scheme PocketQA -configuration Release \
    -sdk iphonesimulator -destination 'id=<sim>' -derivedDataPath build CODE_SIGN_IDENTITY=-
  ```
  This gives `** BUILD SUCCEEDED **` and `codesign -dv` reports `Signature=adhoc`.
  - Ad-hoc signing is required. The fully unsigned build failed to store the session in the keychain, and showed "Sign-in failed".
  - ATS allows local networking only (`NSAllowsLocalNetworking`).
- **Flow** `apps/mobile/e2e/maestro/ios-smoke.yaml`:
  1. clean install, then sign in, then dismiss the routine "Save Password?" prompt with "Not Now" (nothing is saved);
  2. open the newest study and check that "Recording other apps isn't supported on iOS" is visible;
  3. consent, start the session, and check IN PROGRESS, that the back button has no route-group name, and that "Attach screenshot or clip" is offered;
  4. relaunch, open Settings, and check "Mobile Wallet Adapter is Android-only".
- **Result:** `[Passed] ios-settings (19s)` and `[Passed] ios-smoke (30s)`, 27/27 commands COMPLETED. The r2 build is `main.jsbundle` sha256 `8e801e70…`; the r1 build `32385ba4…` also passed both. An earlier run of the same smoke flow logged 27/27 commands COMPLETED.
  - Files: `ios/ios-smoke.junit.xml`, `ios/ios-settings.junit.xml` (`status="SUCCESS"`, device "iPhone 17 - iOS 26.4") and `ios/ios-smoke-steps.txt`.
  - Screenshots: `ios/ios-study-recording-unavailable.png`, `ios/ios-session.png` (icon-only back button), `ios/ios-settings-wallet-unavailable.png`.
  - Maestro output went to the workspace-local `.results/ios` (`--debug-output`).

## GitHub handoff readiness

`docs/handoff/github-private-remote.md` covers local checks only; nothing was executed against GitHub. It flags the system `credential.helper=osxkeychain` risk and gives explicit per-command token steps.
