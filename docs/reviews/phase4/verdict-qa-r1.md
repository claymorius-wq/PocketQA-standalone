# Phase 4 — independent-qa verdict, round 1

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: CHANGES_REQUIRED

  I used Read only and modified nothing. One P1 finding blocks Gate A: on web, a segment the tester removes can still
  be uploaded. The rest of the candidate checks out.

  What checks out
  - Session and roles: the session store is SecureStore on native and sessionStorage on web, with the tradeoff
    documented. The root waits for the saved session before rendering and redirects signed-out users from deep links.
    Role tab groups redirect the wrong role, and the query cache is cleared on sign-out and on a 401. The server is
    still the real authority (404/403).
  - Consent and wording: the consent checkbox gates a real disabled button and sends the consent version. The reward
    disclaimer and "Test credits have no cash value" appear wherever credits do, and "Analysis unavailable" is stated
    honestly. The wallet placeholder never fakes a link.
  - States, theme and tests: loading, error, offline and not-found states, plus capability-unavailable notices; a
    system-stop message in the recorder listener; contrast tests for both themes. Content type is still sniffed
    server-side, and dist-web/ is gitignored.

  Findings

  1. [P1] A segment removed during an upload is uploaded anyway on web. apps/mobile/src/evidence/segments.ts:34-47 and
     app/participation/[id].tsx:143-161, :200
     - uploadKept works from a snapshot: it builds the queue once from live.current and keeps its own list. Each
       onChange(list) then replaces the component state with that snapshot.
     - Scenario:
       i. The tester keeps A and B and taps Upload.
       ii. While A is uploading, the tester taps Remove on B. The button is still shown because B is kept, not
           uploading.
       iii. remove marks B removed and revokes its blob URL.
       iv. When A finishes, onChange(list) puts B back to kept.
       v. The loop then calls beginUpload on B and uploads s.file. Revoking the blob URL does not invalidate the Blob
          object, so B's bytes reach the server.
     - This is exactly the plan §6 threat "Removed private segment leaks". On native the file is deleted first, so B's
       upload fails instead.
     - upload-queue.test.ts and the E2E run only remove items before uploading, so they never hit this.
     - Fix:
       - Before each item, read the current state through a getter or ref and skip anything that isn't kept or failed.
       - Apply transitions with functional setState against the latest list instead of overwriting it with the
         snapshot.
       - Hide or disable Remove for every queued item while busy.
       - Add a jest test that removes B while A's upload is pending and asserts B is never sent.
  2. [P3] Unuploaded evidence is silently lost. participation/[id].tsx:86, :313-331
     - Segments live only in component state. Submitting with kept or unreviewed items, or leaving the screen, discards
       them without uploading. On native the clip files stay orphaned in the cache directory.
     - Fix: Block submit, or show a count-based warning, while uploadQueue(segments).length > 0 or unreviewed items
       exist. Delete local files on unmount, or persist the segment list.
  3. [P3] There is no distinct "unauthorized" state. src/ui/index.tsx:270-283
     - Plan Phase 4 lists unauthorized as its own state. Today FORBIDDEN_ROLE (a wrong-role deep link, or a suspended
       account's "This account is suspended.") shows as "Something went wrong" with a pointless Retry button.
     - Fix: Add a forbidden-state variant without Retry, and test it.
  4. [P3] Builder and admin screens outside the tab groups have no UI role guard. app/builder/*, and participation/[id]
     for builders
     - A tester who deep-links to /builder/review/<own-id> sees Approve and Reject buttons. The server returns 403, so
       nothing is bypassed, but the UI is misleading.
     - Fix: Wrap these routes in a role check that redirects, like RoleTabs does.
  5. [P3] Some icons have no theme colour.
     - Icons rendered without a color prop:
       - Sparkles (builder/review/[id].tsx:106)
       - ShieldCheck (study/[id].tsx:63)
       - Wallet (WalletSection.tsx:19)
       - Smartphone (SettingsScreen.tsx:53)
     - These may fall back to black and nearly disappear on dark surfaces.
     - Fix: Pass colors.text or the relevant tone colour, and check against the dark screenshots.
  6. [P3] Builder-side media can be cached to disk on native. src/evidence/MediaPreview.tsx:19
     - expo-image may disk-cache playback URLs, which would keep private evidence on the builder's device after the
       5-minute token expires.
     - Fix: Set cachePolicy="none" for evidence.
  7. [P3] Every finding is attached to the first evidence item. builder/review/[id].tsx:43 always sends evidence[0].id
     as evidenceId, whatever the finding is about.
     - Fix: Let the builder choose an item, or choose none.
  8. [P3] Small items:
     - candidate.md says "Secrets: 156 files clean", but pnpm-verify.txt:5 shows 164.
     - serve-web.mjs:14 uses a startsWith(root) check, which a sibling path like dist-web-x would pass. It only binds
       locally, but root + sep would be correct.
     - New dependencies (@tanstack/react-query, async-storage, expo-dev-client, RNTL ^14, react-native-web ^0.21.3)
       aren't in dependency-versions.md, and some use range specifiers instead of exact pins.

  Re-review is needed after finding 1 is fixed.

✻ Churned for 1m 43s · done 11:38 PM
```
