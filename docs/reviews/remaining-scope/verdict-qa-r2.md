# pqa-qa verdict, remaining scope, round 2 (verbatim pane output; frozen tree c0c11d30)


⏺ I used only Read; Grep and Glob weren't available. I modified nothing and used no subagents. The round-1 P2 and all
  six P3s are fixed, and the evidence files match the claims. Two new P3s and one doc nit remain; none block.

  Round-1 findings

  1. [P2] Study text could promise money to testers — FIXED. In study scope, copy.ts:19-24, :27-28 and :60 now block:
     - payout, still allowing negations like "No payouts";
     - an amount in the same clause as tester words (money-to-testers);
     - an amount in the same clause as a reward word (reward-amount).

     copy.test.ts:73-92 blocks the 8 tester-money phrases and allows the 5 app-describing ones, including "Buy the $5
     item", "Send 0.1 SOL on devnet…", "paid plan" and "payment is successful". review-fixes.test.ts:133-143 confirms
     POST /studies returns 400 for all three of my examples. The reviewer scope is unchanged.

     On the new rules' accuracy:
     - False positives (fail safe; the builder gets a 400 naming the field and can rephrase): "You will get a $5
       discount at checkout", "Claim the $20 sign-up bonus", "Split the bill: $3 per person". Acceptable for the MVP.
     - False negatives: see new finding 1.
  2. [P3] Wrong "expired" text and lost signature — FIXED. The expired message now reads "No signature was reported in
     time…" (TransferCard.tsx:35-40). Reporting the signature is retried, and a final failure raises
     SentNotRecordedError, shown as "Sent, not recorded" (reportSignature.ts, sendTransfer.android.ts:29). Tested in
     __tests__/report-signature.test.ts.
  3. [P3] Admins couldn't see the evidence — FIXED. adminStuck now returns tasks (admin.ts:95). The Stuck tab's "Review
     work" section shows tasks, notes and evidence playback (stuck.tsx:17-35, EvidenceItem.tsx). Admins still can't
     approve, reject or add findings through the builder routes: the route table keeps those builder-only, and the
     role-guard tests cover it.
  4. [P3] Deletion kept decision text — FIXED. Audit reasons on the tester's participations and disputes are now
     redacted (account.ts:187-195), and ADR 0002 is updated.
  5. [P3] Handoff push without the token — FIXED. The token is now set on the push command itself
     (github-private-remote.md:30), and the credential helper picks it up from the environment.
  6. [P3] Narrow import guard — FIXED. The package name now matches in any quotes (platform-modules.test.ts:19).
  7. [P3] Doc inconsistencies — PARTIAL. candidate.md:32 now names sendTransfer.android.ts, and progress.md:23 names
     one current APK (e758f321). A few stale lines remain; see new finding 3.

  Evidence check
  - pnpm-verify.txt: contracts 14, domain 168, api 271, mobile 124, EXIT=0.
  - native/run-20261003-030814/summary.txt: 10/10 flows EXIT=0, active_projections=0, transfer awaiting_signature
    signature=null.
  - remaining-scope-playwright.txt: 8 passed.
  - The chain is labelled a test double. The faucet 429, the real device, the real wallet and the real iPhone are all
    still reported as blocked.

  New findings (P3, non-blocking)

  1. [P3] Some natural payout promises still pass in study text. copy.ts:22: TO_TESTERS needs a subject plus
     get|receive|earn|be paid, or a per|each <tester…> phrase. These pass in study scope:
     - "Complete this study to receive 10 USDC"
     - "20 USDC for joining"
     - "Top 3 testers win $100"
     - "We'll send you 5 SOL after the session"
     - Fix: Add (?:to|and)\s+(?:receive|get|earn), \bwins?\b with tester words, \bsend\s+you\b, and
       for\s+(?:joining|completing|participating|taking\s+part) near a currency amount. Test each phrase, and keep the
       five allow cases passing.
  2. [P3] The signature report can show a false failure, and its message is too short to use. reportSignature.ts:15-28:
     - If the first submit succeeds on the server but the response is lost, the retries get 409 "Transfer is pending".
       The builder then sees "Sent, not recorded", while the refreshed card shows Pending.
     - The message shows only the first and last 4 characters of the signature, which isn't enough to find the
       transaction in the explorer.
     - Fix: Treat a 409 whose message says "pending" as success, and include the full signature or an explorer link in
       the error.
  3. [P3] A few doc lines are stale.
     - candidate.md:9 still says study scope "bans only earnings promises and fake-AI claims", which is untrue after
       the r2 rules.
     - progress.md:19 still lists the r1 counts (api 268, domain 166, mobile 120), while :24 has the r2 counts.
     - Fix: Update both.

  VERDICT: APPROVE
