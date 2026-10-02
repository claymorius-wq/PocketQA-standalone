# Phase 2-3 — independent-qa verdict, round 1

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: CHANGES_REQUIRED

  Three P2 findings block the commit. The core security controls hold up. I used Read only and modified nothing. Grep
  and Glob weren't available, so I read the five API test files I could locate by name (authz.matrix, account,
  evidence, wallet, log.redact) plus lifecycle and helpers. I didn't find the 7th test file.

  What holds up
  - Ownership: non-owners get 404 on every owner-scoped route (access.ts), and authz.matrix.test.ts checks every route
    × role × non-owner combination.
  - Suspended accounts: blocked by the dispatcher everywhere except me, logout, export and delete (app.ts:102). Media
    is re-checked against an active, authorised token holder each time it's served (evidence.ts:133-141).
  - Evidence: content type comes from the file's magic bytes, and the submit-freeze is re-checked inside the write
    transaction. Files are stored under server-generated UUIDs, so there's no path-traversal surface.
  - Ledger: append-only triggers, plus a unique index that allows only one reward credit per participation. Budgets
    can't go negative because approve and overturn add back the participation's own hold.
  - Wallet nonces: the nonce is burned on the owner's first attempt. The signed message must equal the server-rebuilt
    SIWS text, so domain, chain and expiry are all bound. Another account's nonce is rejected.
  - Transfers: sender, recipient and amount are fixed by the server, and the block-time, genesis-hash and single-use
    signature checks are all in place.
  - Config and logs: loopback-only binding, the data-directory guard, and log redaction including the encoded /%6Dedia/
    path.

  Findings

  1. [P2] A builder can reject and then close a study, so the tester loses their right to dispute.
     packages/domain/src/study.ts:33-43, apps/api/src/handlers/participations.ts:122
     - Scenario: The builder rejects every submission and closes the study straight away. closeStudyPlan only refuses
       to close while work is submitted or disputed, so rejected doesn't block it. The whole balance goes back to the
       builder. openDispute then refuses because the study is closed. The tester has no recourse, and the admin has no
       tool to step in. This defeats the rejected → disputed → resolved path in plan §5.1.
     - Fix: Add a dispute window of N days from decided_at. While any rejected participation is inside its window,
       either:
       - closeStudyPlan refuses to close, or
       - closing goes ahead, disputes stay open after close, and that participation's hold is released only when the
         window ends.
     - Add a test for reject → close → dispute.
  2. [P2] Account deletion leaves personal data behind that ADR 0002 doesn't mention.
     apps/api/src/handlers/account.ts:146-181
     - Scenario: A tester who opened a dispute and linked a wallet deletes their account. Three things survive:
       - disputes.reason: free text the tester wrote, still keyed to their id;
       - devnet_transfers.sender and recipient: their wallet address, which is a pseudonymous identifier that links on
         chain, even though wallet_links is deleted;
       - audit reason text that names them.
     - Plan Phase 7 requires deletion to remove personal data, with any retention exception documented. These three
       aren't listed.
     - Fix:
       - Replace the dispute reason with [deleted] where opened_by = user.
       - Replace transfer addresses where the user is the builder or the tester.
       - Or list each of these as a retention exception in ADR 0002.
     - Extend the deletion test to assert this.
  3. [P2] Approve notes and findings skip the earnings-language check. apps/api/src/handlers/participations.ts:20, :35,
     :105-112
     - Scenario: A builder approves with the note "Payment sent, you earned 50!". assertCleanCopy runs only on the
       rejection reason, so the note is saved as decisionReason and shown to the tester. Finding titles and
       descriptions are never checked either. Plan §2 requires the banned-phrase check on all builder-entered text, and
       "payment complete" is exactly the fake-payment wording it exists to block.
     - Fix: Run assertCleanCopy on ApproveBody.note and on the finding title and description, and add one test for
       each.
  4. [P3] Upload limits aren't enforced under concurrency. apps/api/src/handlers/evidence.ts:59-73
     - The 20-item count, the 500 MB byte total and the duplicate check all run before the file streams in. They aren't
       repeated inside the insert transaction, so parallel uploads can exceed the limits.
     - A raced duplicate clientSegmentId hits the UNIQUE constraint and returns 500 INTERNAL.
     - Fix: Re-check count, bytes and duplicates inside the transaction at :89, and map constraint errors to
       CONFLICT_STATE.
  5. [P3] Any file with an ftyp box is accepted as MP4. evidence.ts:18 matches on the box name alone, so HEIC, AVIF and
     MOV files are stored as video/mp4.
     - Fix: Allowlist the MP4 brands (isom, iso2–iso6, mp41, mp42, avc1, dash).
  6. [P3] Login can leak which emails exist, and the rate limiter's memory grows without bound. account.ts:76-86
     - When the email is unknown, verifyPassword(null) returns immediately without running argon2, so response timing
       reveals whether an account exists.
     - The failures Map is never pruned.
     - Fix: Verify against a dummy hash when the email is unknown, and prune expired entries.
  7. [P3] Users stuck behind an inactive or suspended builder can't delete their account or get a review.
     studies.ts:194 and account.ts:151-154
     - A suspended builder's published studies still accept consents and submissions, but that builder can't review
       them.
     - A tester with submitted work can't delete their account until a review happens, which may never come.
     - Fix: Hide studies from suspended builders in eligibility and consent. Give admins a way to withdraw or close
       stuck submissions, or document the limitation in ADR 0002.
  8. [P3] Playback tokens survive logout and deletion. They stay valid for up to 5 minutes; deletion cascades only
     through the evidence rows.
     - Fix: Delete the user's playback tokens on logout.
  9. [P3] Transfers are verified at confirmed commitment, not finalized. apps/api/src/rpc.ts:27
     - A transaction confirmed at that level can, in rare cases, be rolled back.
     - Fix: Use finalized before marking a transfer confirmed, or record the choice in the ADR.
  10. [P3] Some tests are weak, and some caps are untested.
      - wallet.test.ts:150-159 claims "stays pending while RPC is down" but only checks for a 503; it never asserts
        that the stored status is still pending.
      - evidence.test.ts:84 (existsSync(mediaDir)) asserts nothing useful.
      - As the candidate says, the 100 MB per-file and 500 MB per-participation caps are untested. They could be tested
        by making the limits injectable.
  11. [P3] The admin-creation script takes the password from an environment variable on the command line.
      apps/api/scripts/create-admin.ts:2 does this, so the password lands in shell history.
      - Fix: Prompt for it on stdin with echo off.

  The candidate's TDD disclosure is honest: the API handlers were written before their tests. The mutation table is a
  reasonable stand-in, and the authorisation matrix is real, not vacuous. Re-review is needed after findings 1–3 are
  fixed.

✻ Crunched for 3m 10s · done 11:03 PM
```
