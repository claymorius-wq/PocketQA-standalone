# Phase 4 — independent-qa targeted re-review (round 3)

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: APPROVE

  Both round-2 P3 fixes are in place. I used Read only and modified nothing.

  - Remove during an in-flight upload (P3 #1): fixed. removeSegment (segments.ts:32-38) does nothing unless the item is
    recorded, kept or failed. It deletes the local copy only after the state change succeeds. The screen's remove
    (participation/[id].tsx:161-163) goes through it, so the local copy is deleted exactly once. The test at
    upload-queue.test.ts:89-98 covers both the uploading and the kept case.
  - Uploads after leaving the screen (P3 #2): fixed. On unmount the screen sets a cancelled ref (:102-109). The
    uploader then reads an empty list (:169), so remaining items are skipped. An upload already in flight finishes, and
    nothing new starts. The test at upload-queue.test.ts:72-86 checks this.
  - Evidence files: pnpm-verify.txt shows mobile 99/99, api 238/238 and EXIT=0. playwright.txt shows 4 passed.

  Findings:

  1. [P3] Tapping Remove on an item that is already uploading does nothing visible. This only happens in the one render
     before the button disappears. Consider a short "Already uploading" notice in Phase 5.

  Gate A is ready for Hamza's approval.

✻ Churned for 14s · done 11:46 PM
```
