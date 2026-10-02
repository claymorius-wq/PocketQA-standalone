# Phase 2-3 — independent-qa verdict, round 2

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: APPROVE

  All three P2s from round 1 are fixed. No P0, P1 or P2 is open; three new P3s are listed at the end. I used Read only
  and modified nothing.

  Round-1 findings

  1. [P2] Reject-then-close — FIXED. participation.ts:35-42 adds a 7-day DISPUTE_WINDOW_MS, plus holdsBudget and
     canOpenDispute. closeStudyPlan refuses to close while any rejection is still inside its window (study.ts:41-43),
     and openDispute now checks the window, not the study status (participations.ts:124). review-fixes.test.ts:19-36
     covers both cases: inside the window (close blocked, hold kept, dispute allowed) and after it (dispute refused,
     hold released, close allowed).
     - Budget math still holds. Every non-withdrawn participation fills a slot, so the time-dependent hold can't
       over-commit the reserve. Approve and overturn still add back the participation's own hold.
     - Edge cases are consistent. At exactly decided + 7d, disputes and close agree, because both use the same strict
       <. A builder can't delete their account during a window either: deletion refuses while studies are published or
       paused, and close is blocked while a window is open.
  2. [P2] PII left after deletion — FIXED. On deletion (account.ts:183-187):
     - dispute reasons become [deleted];
     - transfers involving the user are deleted;
     - audit reasons targeting the user are redacted;
     - the user's playback tokens are deleted.

     ADR 0002 lines 10-23 now document all four, plus the findings that are kept. The test is at
     review-fixes.test.ts:40-63.
  3. [P2] Banned wording — FIXED. The copy check now runs on:
     - approve notes (participations.ts:20);
     - finding titles and descriptions (:106);
     - dispute resolution notes (admin.ts:26).

     Each is tested in review-fixes.test.ts:76-94.
  4. [P3] Upload race — FIXED. Count, byte and duplicate checks are repeated inside the insert transaction
     (evidence.ts:98-106), and unique-constraint errors now return 409 (app.ts:68).
  5. [P3] MP4 sniffing — FIXED. There is now a brand allowlist (evidence.ts:17, :21), and a HEIC file is rejected in a
     test.
  6. [P3] Login timing and memory — FIXED. Unknown emails are checked against a dummy argon2 hash (account.ts:85), and
     the failure map is pruned once it passes 10,000 entries.
  7. [P3] Stuck submissions — PARTIAL, accepted. Studies from suspended builders are hidden and refuse consent
     (studies.ts:85-88, :171, tested). There is still no admin tool to force a decision; ADR 0002 records this as a
     known limitation for Phase 7.
  8. [P3] Playback tokens outliving logout — FIXED. Logout deletes them (account.ts:104, tested). Revocation on
     deletion is in the code but not tested; see new finding 2.
  9. [P3] Commitment level — FIXED. Transfers are now verified at finalized (rpc.ts:30, ADR 0001 decision 9).
  10. [P3] Weak tests — PARTIAL. The RPC-down test now checks the stored status is still pending
      (wallet.test.ts:157-158), and the existsSync check was replaced with a real assertion (evidence.test.ts:84-85).
      The 100 MB per-file and 500 MB per-participation caps are still untested, as the candidate says.
  11. [P3] Admin password — FIXED. It is now read from a no-echo prompt or piped stdin (create-admin.ts:13-27), never
      from arguments or environment variables.

  New findings (P3, non-blocking)

  1. [P3] The 409 mapping for database constraint errors is too broad. app.ts:68 maps every SQLITE_CONSTRAINT* error
     to 409. That includes the ledger append-only trigger (SQLITE_CONSTRAINT_TRIGGER) and foreign-key violations. A
     real invariant breach would therefore look like a normal conflict to the client and wouldn't be logged.
     - Fix: Map only SQLITE_CONSTRAINT_UNIQUE and SQLITE_CONSTRAINT_PRIMARYKEY to 409. Log everything else as INTERNAL.
  2. [P3] Playback-token revocation on deletion is untested. The n = 0 assertion at review-fixes.test.ts:53-54 runs
     before deletion, in a test that never issued a token, so it proves nothing. The test at :65-72 is titled "logout
     and deletion" but only exercises logout.
     - Fix: Issue a token, delete the account, then assert that /media/<token> returns 404 and that no token rows
       remain.
  3. [P3] Deleting one account erases the other party's transfer record. When a tester deletes their account, the
     builder's demo-transfer rows go too, including confirmed ones (account.ts:186). The reverse also happens. ADR 0002
     documents this, but it does destroy the counterparty's transaction history.
     - Fix (optional): Replace the deleted user's address with a placeholder and keep the row, rather than deleting it.

  The freeze candidate is ready for Hamza's approval, with the P3 items carried forward.

✻ Crunched for 1m 6s · done 11:08 PM
```
