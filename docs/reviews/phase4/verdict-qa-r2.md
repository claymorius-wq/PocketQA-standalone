# Phase 4 — independent-qa verdict, round 2

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: APPROVE

  The P1 race is fixed and all seven P3s are fixed. No P0, P1 or P2 is open; two new P3s are listed below. I used Read
  only and modified nothing.

  Round-1 findings

  1. [P1] Removed segment uploaded during another upload — FIXED. uploadKept(get, upload, update) (segments.ts:37-51)
     now re-reads the live list before each item and skips anything that isn't kept or failed. Every transition is a
     functional update. The screen keeps the ref as the single source of truth (participation/[id].tsx:93-97), and
     remove goes through update (:158-162). The new test (upload-queue.test.ts:48-69) removes B while A is in flight
     and checks that only A is sent; the candidate reports it failed against the old code first.
     - Remove a different item during an upload: safe. The live state is re-checked before each send, and JS is
       single-threaded, so nothing can change between the check and the upload(current) call.
     - Retry a failed item: safe. A removed failed item is skipped, because the transition table allows failed →
       removed and uploadQueue excludes removed items.
     - Remove the same item while it's uploading: Remove is hidden for uploading items (:215), and the domain refuses
       uploading → removed. There is a narrow window with a stale render; see new P3 #1.
     - Unmount mid-upload: no removed segment can be sent, but kept items keep uploading after the tester leaves; see
       new P3 #2.
  2. [P3] Unuploaded evidence lost — FIXED. Submit is disabled and the "Evidence not uploaded yet" notice shows while
     any item is recorded, kept, failed or uploading (:98-99, :331-336). Local copies are deleted on unmount
     (:101-106).
  3. [P3] No unauthorized state — FIXED. FORBIDDEN_ROLE renders a distinct "Not allowed" state with no Retry
     (ui/index.tsx:274-277).
  4. [P3] No UI role guard — FIXED. RequireRole wraps new-study, review and participation
     (builder/new-study.tsx:97-103, participation/[id].tsx:382-388). It doesn't check ready itself, but the root layout
     already waits for it.
  5. [P3] Untinted icons — FIXED per the candidate. I didn't re-open every icon site.
  6. [P3] Native disk cache — FIXED. MediaPreview.tsx:19 sets cachePolicy="none".
  7. [P3] Findings always linked to the first evidence item — FIXED. The link is now an explicit choice: None or #n
     (review/[id].tsx:44-46, :69-79).
  8. [P3] Small items — FIXED.
     - serve-web.mjs:14 checks root + sep.
     - RNTL is pinned to 14.0.1 and react-native-web to 0.21.3.
     - pnpm-verify.txt shows mobile 97/97 and EXIT=0; Playwright shows 4 passed.

  New findings (P3, non-blocking)

  1. [P3] Remove deletes the local copy before checking the state. participation/[id].tsx:158-162
     - If the tester taps Remove on an item whose upload has just started, before the re-render hides the button,
       deleteLocal runs first. Then applySegment(...'remove') throws, because uploading → removed isn't allowed. The
       upload continues and completes, while the tester believes the item was removed.
     - Fix: In remove, read live.current, do nothing if the item is uploading, and only call deleteLocal after the
       transition succeeds.
  2. [P3] Uploads continue after the screen unmounts. participation/[id].tsx:101-106, :164-181
     - The unmount cleanup deletes local files but doesn't stop uploadKept. On web, s.file Blobs are still referenced,
       so remaining kept items upload after the tester has navigated away, even though the cleanup comment says leaving
       the screen discards them. These are items the tester kept, so this isn't a privacy leak, but the behaviour
       doesn't match the stated intent.
     - Fix: Set a cancelled ref on unmount, and either make get() return [] or have uploadKept check it before each
       item. Add a jest test for it.

  Gate A is ready for Hamza's approval, with these two P3s carried into Phase 5. Phase 5 adds the real recorder, which
  makes both paths more likely.

✻ Crunched for 48s · done 11:45 PM
```
