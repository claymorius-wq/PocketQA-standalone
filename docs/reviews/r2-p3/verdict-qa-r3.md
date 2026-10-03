# pqa-qa verdict, r2 P3 follow-ups, round 3 (verbatim pane output; frozen tree 5a342546)


  Read 14 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing and used no subagents. All three r2 P3s are
  fixed, nothing at P0, P1 or P2 is open, and the evidence matches the claims.

  r2 findings

  1. Natural payout phrasings in study text — FIXED. TO_TESTERS adds to receive|earn|win, send|pay|give you, for
     joining|completing|…|your time|feedback|participation, and testers/you win (copy.ts:22-30).
     - Checked by hand against the regexes, my four phrases are now blocked (copy.test.ts:83-86): "Complete this study
       to receive 10 USDC", "20 USDC for joining", "Top 3 testers win $100", "We'll send you 5 SOL after the session".
     - The allow cases still pass, including the two new ones: "…to get free shipping" and "Pay $5 to unlock…" (:94).
     - Leaving out "to get" is reasonable: it avoids blocking shopping tasks, and the phrasings it would catch are
       uncommon.
  2. False "Sent, not recorded" and a short signature — FIXED.
     - Server: the idempotent branch (wallet.ts:193-195) runs only after the ownership check (:191-192). It fires only
       when the stored signature equals the one submitted, and it changes nothing: it only re-verifies, and that only
       does work for pending rows.
     - Different signature: it still reaches the existing awaiting_signature check and gets 409.
     - Cross-intent reuse: the stored signature is null, so the request takes the normal path and the unique constraint
       returns 409.
     - Confirmed or failed intents: re-reporting the same signature returns the true current state with no change.
     - Tests and docs: remaining-scope.test.ts:151-160 covers the same signature (200, still pending), a different one
       (409) and a non-owner (404). The client error now carries the full signature (reportSignature.ts:22-25,
       report-signature.test.ts:21-23). contract-changes.md:12 records the behaviour change.
  3. Stale doc lines — FIXED, with one remaining nit. remaining-scope/candidate.md:9 now describes the study scope
     correctly. progress.md:18-27 has the merge plus this branch. See new finding 3.

  Evidence check
  - pnpm-verify.txt: api 271, mobile 124, EXIT=0, matching the claim.
  - native/run-20261003-032219/summary.txt: 10/10 flows EXIT=0, active_projections=0, transfer awaiting_signature
    signature=null.
  - playwright.txt: 8 passed (44.6 s).
  - verification.md:294-306 shows the red-then-green runs, mutations M22–M26, the APK sha256 14ac0c9e… and the iOS
    passes.
  - The faucet 429, the physical device, the real wallet and the real iPhone are still reported as blocked.

  New findings (P3, non-blocking)

  1. [P3] The new rules block some legitimate tasks and still miss two payout phrasings. copy.ts:27-29
     - Blocked by mistake (fail safe; the builder gets a field-named 400):
       - "The app will send you a $5 coupon"
       - "Complete checkout to receive the $5 discount"
       - "Enter the code to win $50"
       - "Stake to earn 10 SOL", which matters because staking and wallet apps are the core Seeker audience
     - Still allowed: "Earn 10 SOL" (earn-money requires money, cash, $, usd or income, and there's no "to") and "Get
       20 USDC after the session".
     - Fix (optional): Add \bearn\s+\d…(sol|usdc|…) and ^\s*get\s+\d… as tester-money patterns. Document the false
       positives and the suggested rewording ("the app shows a $5 coupon") in the new-study hint.
  2. [P3] A same-signature retry while the RPC is down still ends in "Sent, not recorded". wallet.ts:195: the
     idempotent branch calls reverify, which throws CHAIN_UNAVAILABLE (503) when the RPC is down. All three client
     retries then fail, and the builder sees "Sent, not recorded" even though the server holds the signature.
     - Fix: In the idempotent branch, use await reverify(ctx, row).catch(() => row), as participationTransfers already
       does.
  3. [P3] Two status lines in progress.md contradict the rest of the file.
     - :7 still says "branch feat/remaining-scope, NOT reviewed, NOT merged", but :19 says it was merged as fac4d34.
     - :27 says fix/r2-p3 "needs native revalidation", but run 20261003-032219 already did it.
     - Fix: Update both lines.

  VERDICT: APPROVE
