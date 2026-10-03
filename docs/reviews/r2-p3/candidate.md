# Freeze candidate: review r2 P3 follow-ups

**Branch:** `fix/r2-p3` (uncommitted until review). **Base:** `main` at `fac4d34` (remaining scope, pqa-qa r2 APPROVE). **Author:** lead (solo, claude-opus-5-5). **Reviewer:** `pqa-qa` (read-only).

The three non-blocking P3s from `docs/reviews/remaining-scope/verdict-qa-r2.md`:

1. **More natural payout promises were passing in study text.**
   - `packages/domain/src/copy.ts` `TO_TESTERS` now also matches:
     - `to receive|earn|win`;
     - `send|pay|give you`;
     - `for joining|completing|participating|taking part|your time|feedback|participation`;
     - `testers/you win`.
   - Each must sit in the same clause as an amount.
   - "to get" is deliberately not included, because shopping tasks use it ("to get free shipping").
   - Tests (`copy.test.ts`), red then green:
     - The reviewer's 4 phrases are now blocked: "Complete this study to receive 10 USDC", "20 USDC for joining", "Top 3 testers win $100", "We'll send you 5 SOL after the session".
     - New allow cases: "Add the $5 item to the cart to get free shipping", "Pay $5 to unlock the premium plan".
   - Mutations, each caught (`1 failed`):
     - M22: drop `to receive`;
     - M23: drop `send you`;
     - M24: drop `for joining`;
     - M25: drop `testers win`;
     - M26: add `to get`, which over-blocks.
2. **A false "Sent, not recorded", and a signature too short to look up.**
   - Server: `submitTransferSignature` with the signature already recorded on that intent now returns the transfer (an idempotent retry). A different signature is still 409, and a non-owner still gets 404.
   - Client: the final error carries the **full** signature ("Check the devnet explorer for signature … before starting another transfer").
   - Tests: `apps/api/test/remaining-scope.test.ts` (red: `expected 409 to be 200`) and `apps/mobile/__tests__/report-signature.test.ts` (red: expected the full signature). Both are now green.
   - Logged in `docs/decisions/contract-changes.md` as a behavior change with no schema change.
3. **Stale doc lines.**
   - `remaining-scope/candidate.md` item 1 now describes the study scope correctly.
   - `progress.md` has one current status block: the merge `fac4d34` plus this branch.

## Evidence
- `pnpm verify`, EXIT=0 (`pnpm-verify.txt`): secrets 342 files clean, contracts 14, domain 168, api 271, mobile 124.
- iOS simulator, r3 build (`main.jsbundle` `32a4ebac…`): `[Passed] ios-settings (19s)` and `[Passed] ios-smoke (31s)`. Files: `ios/*.junit.xml`.
- **Android:** `apps/mobile/artifacts/pocketqa-release-14ac0c9e.apk`, sha256 `14ac0c9e9297a51fff2a0ad69f3c3cc82ee6bbc5176b08f1f60b2e7b579b31e8`, 51,026,972 bytes, built from this tree.
  - Run `20261003-032219`: **10/10** flows EXIT=0 with `active_projections=0`, and the transfer is `awaiting_signature signature=null`. Evidence: `native/run-20261003-032219/`.
  - The API started at 03:22:15. No API, domain or contract source changed after that (`find -newermt` was empty).
- **Web E2E:** `npx playwright test` gives `8 passed (44.6s)` (`playwright.txt`). The screenshots it regenerated were restored to their committed versions.

## Still blocked (unchanged)
- A real confirmed devnet transfer: the faucet returned 429. No further faucet requests were made.
- Physical Android/Seeker device, real production wallet, real iPhone.
