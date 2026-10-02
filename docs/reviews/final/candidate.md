# Phase 8 round 2: fixes for `verdict-qa-r1.md` (branch `fix/final-qa`, base `f9950c6`)

**P2: "paid", "payout" and currency claims got past the copy rules.** Fixed test-first.
- `packages/domain/src/copy.ts` adds three rules:
  - `paid-payout`: `\b(paid|pay-?outs?)\b`, after stripping honest negations such as "not paid out", "No payouts" and "not a reward payout";
  - `sent-to-wallet`: "sent/transferred/paid … to your wallet";
  - `currency-amount`: `$<digit>`, and amounts in USDC/USDT/USD/EUR/SOL/SKR/BTC/ETH.
- Domain tests include the reviewer's exact scenario: "You've been paid — payout of 50 USDC sent to your wallet".
- New API test in `review-fixes.test.ts` ("final QA P2"). It **failed against `main`'s copy.ts** (`1 failed | 9 passed`) and passes with the fix.
- The UI copy scan (`copy.test.ts`, 46 files) is still clean, so no existing app string needed rewording.

**P3s:**

| # | Fix |
|---|---|
| 2 | `docs/progress.md`: 9 native flows; finished items struck through (media redaction, single SIWS domain); scanner policy decided. |
| 3 | New Playwright spec `e2e/account-delete.spec.ts`: export (JSON download) → the typed confirmation stays disabled until "DELETE MY ACCOUNT" → delete → lands on sign-in → signing in again fails. |
| 4 | The final record is named "local MVP, emulator-verified", not "Gate B final passed" (see below). |
| 5 | Process items for Hamza are listed under "Needs Hamza" in progress.md and in the final summary. |

**Final verification on this branch:**
- `pnpm verify` EXIT=0 (`pnpm-verify.txt`): secrets 245 files clean, contracts 14/14, domain 156/156, api 239/239, mobile 111/111.
- Web Playwright: **5 passed** (`playwright.txt`).
- Native, with the APK rebuilt to include the domain change:
  - `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  - 51,002,616 bytes, sha256 `82f214ece799d209ffac6ef7279977d68e9c10154ed4e040600b3fe90cbdce85`
  - run `20261003-014123`: 9/9 flows EXIT=0, 0 active projections after each (`docs/reviews/gate-b-emulator/summary.txt`)
