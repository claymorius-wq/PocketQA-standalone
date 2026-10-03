# pqa-qa security verdict, cloud increment 3, round 2 (verbatim pane output; frozen tree 0a7fbf45)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env* or credential files. The two code fixes are correct and the r1-approved behaviour is unchanged.
  Two small P3s remain.

  Round-1 findings

  1. [P3 #1] Bytes swapped between the check and the copy — FIXED.
     - HEAD now returns the ETag, and both the 16-byte sniff and the promotion copy are pinned to it: GetObject IfMatch
       and CopySourceIfMatch (r2.ts:40-59, evidence.ts:324-343).
     - A failed precondition maps to StorageChanged, which puts the intent back to pending and returns a retryable 409
       (evidence.ts:313-316).
     - The fake S3 now uses MD5 ETags and returns 412 on a mismatch for both GET and copy (fakeS3.ts:30, :38, :57-58).
     - The swap test shows that bytes changed after HEAD produce no evidence and no final object, and that the next
       completion checks and records the bytes actually stored. Mutation S9 is caught.
  2. [P3 #2] Status resets undoing a concurrent close — FIXED. Every reset during completion now uses AND status =
     'completing' (evidence.ts:312), so an intent closed by account deletion or the sweep is never reopened.
  3. [P3 #3–#5] — documented in ADR 0005 §3 limits: the 16-byte sniff, the checks still to record at the real-R2 gate,
     single PUT only, and a single sweep runner.

  Regression check
  - Ownership and the 404 for non-owners, the atomic claim, the size check, the type match, and the in-transaction
    re-check of state, duplicates and quota are unchanged.
  - The deletion outbox, playback re-checks, the shared-demo guard and local mode are unchanged.
  - inc3-pnpm-verify.txt shows EXIT=0.

  New findings (P3, non-blocking)

  1. [P3] A missing ETag silently turns the pinning off. r2.ts:34 returns etag: r.ETag ?? '', and an empty ifMatch is
     falsy, so the sniff and the copy then run unpinned (r2.ts:43, :54). Real R2 always returns an ETag, so this is
     defensive only.
     - Fix: In completeUploadIntent, treat an empty head.etag as transient: put the intent back to pending and return a
       retryable 409, never proceeding unpinned.
  2. [P3] The final "completed" update is unconditional. evidence.ts:356 sets completed by id only, inside the
     transaction. If something else closed the intent between the claim and the transaction, evidence would still be
     recorded for a closed intent. The participation-state re-check covers account deletion today.
     - Fix: Use ... WHERE id = ? AND status = 'completing' and throw inside the transaction if changes !== 1, so the
       existing failure path deletes the copy.

  VERDICT: APPROVE
