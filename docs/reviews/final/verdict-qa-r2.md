# Phase 8 — final independent QA, round 2

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-03.

```text
⏺ VERDICT: APPROVE-LOCAL-MVP

  The round-1 P2 is fixed. No P0, P1 or P2 is open, and the new copy rules have acceptable false positives for a local
  MVP (finding 1 below). I used Read only and modified nothing.

  Round-1 findings

  1. [P2] "paid" and "payout" not blocked — FIXED. copy.ts adds three rules (:18-19, :22-26, :36):
     - paid-payout, which first strips honest negations such as "not paid out", "No payouts" and "not a reward payout";
     - sent-to-wallet;
     - currency-amount.

     The domain tests include the exact scenario I gave, alongside the app's own honest phrases (copy.test.ts:17-22,
     :36-38). The API test review-fixes.test.ts:107-119 rejects all three approve notes and the "Payout processed"
     finding, and still accepts a clean note. The candidate reports it failed against main first (1 failed | 9 passed).
     The UI copy scan stays clean.
  2. [P3] Progress file inconsistent — mostly FIXED. It now says 9 flows (progress.md:16). The finished items are
     struck through (:53, :57) and the scanner policy is recorded (:54). A few status lines are still stale; see
     finding 2.
  3. [P3] Account deletion through the UI untested — FIXED. e2e/account-delete.spec.ts covers:
     - the JSON export download;
     - the confirm button staying disabled until the exact phrase is typed;
     - deletion landing on sign-in;
     - signing in again failing.

     playwright.txt shows 5 passed.
  4. [P3] Emulator-only acceptance items — FIXED. The final record is named "local MVP, emulator-verified".
  5. [P3] Process items for Hamza — FIXED as documentation. They are listed under "Needs Hamza" in progress.md.

  The new copy rules on legitimate study text

  - False positives:
    - "Upgrade to the paid plan" is blocked by paid-payout.
    - "Buy the $5 item" and "Check the price shows $19.99" are blocked by currency-amount.
    - "Send 0.1 SOL to the test address" is blocked by currency-amount, even though wallet apps are Pocket QA's core
      Seeker audience.
    - "Verify the payment is successful", a normal checkout task, is blocked by the older payment-complete rule.
  - Gaps (false negatives): "Reward sent!", "Funds deposited", and "We've never paid late", which is stripped as a
    negation but still implies payment.
  - Judgement: acceptable for the local MVP. False positives fail safe, and the builder gets a clear, field-named 400
    and can rephrase, for example "a small amount of devnet SOL" or "the cheapest item". But this would get in the way
    of real shopping, payment and wallet studies; see finding 1.

  Findings (all P3, non-blocking)

  1. [P3] Apply the payment and currency rules only where Pocket QA is talking to the tester.
     packages/domain/src/copy.ts:16-19, :36
     - Keep paid-payout, sent-to-wallet and currency-amount on approve notes, reject reasons, findings, dispute
       resolutions and UI copy.
     - For a study's objective, tasks, success criteria and build-under-test, keep only the earnings-promise rules
       (earn money, guaranteed, passive income, get paid, airdrop, AI-insights).
     - That lets testers be asked to "buy the $5 item" or "send 0.1 devnet SOL" without letting builders claim a
       payout.
     - Add tests for "paid plan", "$5 item", "0.1 SOL" and "payment is successful" in task text.
     - Do this before any real pilot.
  2. [P3] A few status lines are stale.
     - docs/progress.md:18 still says "deletion is tested at API level"; it's now covered end to end too.
     - :19 still says Phase 8 "not started".
     - :14 (238 API tests) and :15 (99 jest, 4 Playwright) are older counts; the current ones are 239, 111 and 5.
     - Fix: Update them, or mark them "as of the merge".
  3. [P3] The native summary doesn't say which run or APK produced it. docs/reviews/gate-b-emulator/summary.txt is
     identical in content to the previous run. Only verification.md:217 links it to run 20261003-014123 and APK
     82f214ec….
     - Fix: Write the run id and APK sha256 into summary.txt itself.

  Summary

  - Passed locally:
    - Foundation, secret scanner and .gitignore.
    - Domain: state machines, ledger, copy rules, transfer and SIWS verification.
    - API: 239 tests, including the authorisation matrix, log redaction, loopback-only binding and export/delete.
    - Web app: Gate A, with 5 Playwright end-to-end runs and the light/dark screenshots.
    - Admin disputes, moderation and audit, plus the UI deletion.
    - Emulator: Android recorder and MWA link with the mock wallet; 9 Maestro flows with 0 active projections after
      each, and the server-side checks re-captured.
  - Blocked:
    - real-device S0/B1 (no Seeker or Android 14+ phone);
    - B2 with a real production wallet;
    - Hamza's review of the consent and retention wording;
    - Hamza's acknowledgement of the routed-around denial and of the prompt-only read-only limit on this reviewer;
    - the stale "plan only" lines in docs/plans/*;
    - removing the AVD PIN.
  - Not built:
    - devnet transfer UI and live on-chain confirmation (the API is ready);
    - builder view of disputes on their own studies;
    - admin tool to force a decision on a stuck submission;
    - MWA sign_in_payload flow;
    - iOS run;
    - AI provider (correctly reported as unavailable).

✻ Churned for 43s · done 1:53 AM
```
