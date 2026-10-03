# pqa-qa verdict, remaining scope, round 1 (verbatim pane output; frozen tree c04ead6e)


⏺ Starting the remaining-scope review with the candidate summary.

  Read 26 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available in this pane. I modified nothing and used no subagents. The
  candidate's code mostly holds up. One P2 blocks the merge: the new study-scope copy rule now lets a builder put a
  real-money promise in study text that testers read.

  What holds up
  - Builder dispute view: GET /studies/:id/disputes uses ownStudy, so a non-owner gets 404 and a tester gets 403. The
    test is remaining-scope.test.ts:23-35.
  - Admin stuck-submission decisions:
    - The route is admin-only.
    - Anything not stuck gets 409.
    - A reason of at least 10 characters is required and is checked with the reviewer copy rules.
    - An approval credits through the normal ledger path, so a second attempt also gets 409 and the balance stays 50.
    - The audit entry is participation.approve|reject with [stuck: …]. The test is :50-68.
  - Transfer support routes: the transfer list is restricted to the two parties. The blockhash route is owner-only and
    checks the genesis hash, so a mainnet genesis gets 503.
  - Transaction bytes: buildDevnetTransferTx has a correct legacy layout. Because it uses a devnet blockhash, a wallet
    that wrongly sends it to mainnet would have it rejected.
  - Honest transfer states: TransferCard shows "Confirmed on devnet" only from the server's verdict. Nothing says
    "paid", and it's labelled "not a reward".
  - iOS fixes: the MWA files are renamed to *.android.ts and pinned by a test. The fresh-install marker drops a
    leftover keychain session, and the iOS crash was reproduced before the fix and passes after it.
  - Blocked items stated honestly: the web chain is clearly labelled a test double. The devnet faucet 429, the unfunded
    mock-wallet send, simulator-only iOS, and the missing physical device and real wallet are all reported as blocked,
    not passed. The GitHub handoff doc says nothing was executed against GitHub.

  Findings

  1. [P2] Study text can now promise real money to testers. packages/domain/src/copy.ts:26-29, :46;
     apps/api/src/handlers/studies.ts:44-45
     - In 'study' scope, paid-payout, currency-amount, sent-to-wallet and payment-complete are all switched off. The
       rules left only catch phrasings like "earn money", "earnings", "get paid" and "guaranteed".
     - Scenario: A builder publishes a study titled "Payout: 20 USDC per tester", with the objective "Testers receive
       $25 each" and the task "Bonus: $20 for completing this flow". All three pass lintStudy and the new-study
       screen's live check, then show to testers on Discover and the study page.
     - On main before this branch, all three were blocked. This breaks CLAUDE.md ("test credits only, no guaranteed
       earnings") and plan §2, which requires earnings promises in builder text to be blocked.
     - Fix: In 'study' scope, keep the app-describing text (prices, "0.1 SOL on devnet", "paid plan", "payment is
       successful"), but block reward wording aimed at testers:
       - pay-?outs? always;
       - a currency amount within about 40 characters of you|tester(s)|participant(s)|each|per
         (tester|participant|session|test);
       - (bonus|reward|compensation|stipend|incentive) near a currency amount.

       Add domain tests that reject the three examples above and still allow "Buy the $5 item", "Send 0.1 SOL on devnet
       to the address shown", "Upgrade to the paid plan" and "Verify the payment is successful". Add an API test that
       createStudy returns 400 for "Payout: 20 USDC per tester".
  2. [P3] The "expired" message can be wrong if the app is killed between sending and reporting.
     apps/mobile/src/wallet/sendTransfer.android.ts:18-28, TransferCard.tsx:34
     - Scenario:
       i. The wallet signs and sends the transaction and it lands on devnet.
       ii. submitTransferSignature then fails (the app is killed or the API is briefly unreachable).
       iii. The intent expires, and the card shows "No transaction landed in time", which is false.
     - The builder can then start a second transfer, sending devnet SOL twice. It has no value, but the message is
       wrong.
     - Fix:
       - Change the expired copy to "No signature was reported in time".
       - Keep the signature locally and retry the submit.
       - Optionally, look up the sender's recent signatures before marking an intent expired.
  3. [P3] Admins decide stuck work without seeing the evidence. apps/mobile/app/(admin)/stuck.tsx:43-49 shows only
     counts of evidence and notes. The API allows admins to view evidence (partyParticipation includes admins), but the
     screen offers no way to watch clips or read notes before approving or rejecting in the owner's place.
     - Fix: Add a read-only admin review view (notes, evidence playback, findings), or make the builder review screen's
       role guard also accept admins in read-only mode.
  4. [P3] Account deletion doesn't scrub the new admin decision reasons. Deletion redacts only audit rows with
     target_type = 'user' (account.ts:187). Admin decision reasons are stored on target_type = 'participation' rows,
     and their text describes the tester's work.
     - Fix: Also redact audit rows whose target is one of the deleted tester's participations, and update ADR 0002.
  5. [P3] The push command in the GitHub handoff wouldn't get the token. docs/handoff/github-private-remote.md:30-32:
     the git credential helper echoes $GH_TOKEN, but steps 2, 3 and 5 only set it inline for the gh commands. Step 4
     runs with an empty password, so it fails, which is at least safe.
     - Fix: Prefix the command with GH_TOKEN="$TOKEN", or export it inside a subshell for just that command.
  6. [P3] The MWA import guard is narrow. __tests__/platform-modules.test.ts:19 matches only static single-quoted from
     '…' imports. Double quotes, require(...), a dynamic import(...) or a re-export would slip through.
     - Fix: Match ['"]@solana-mobile/mobile-wallet-adapter-protocol['"] anywhere in the file.
  7. [P3] Some docs are inconsistent.
     - candidate.md:32 still names sendTransfer.native.ts, which is now sendTransfer.android.ts.
     - progress.md:16 calls 82f214ec the tested APK, while :22 says the frozen candidate 85ae621a passed 10/10.
     - Fix: State one current tested APK and keep the other as history.

  VERDICT: CHANGES_REQUIRED

✻ Churned for 1m 59s · done 3:03 AM

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
