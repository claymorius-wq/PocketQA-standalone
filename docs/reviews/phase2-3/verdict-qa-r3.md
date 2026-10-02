# Phase 2-3 — independent-qa targeted re-review (round 3)

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: APPROVE

  Both post-approval P3 fixes are in place. I used Read only and modified nothing.

  - Constraint errors (new P3 #1): fixed. apps/api/src/app.ts:69 now returns 409 only for unique and primary-key
    violations. Trigger and foreign-key failures fall through to the 500 INTERNAL path, which is logged (:78).
    - A raced duplicate segment upload still gets 409, because it hits a unique constraint.
    - The new test (lifecycle.test.ts:164-173) injects a trigger that aborts the reward insert during approve and
      checks for 500 INTERNAL. The candidate says this test failed against the old broad mapping before passing.
  - Revocation on deletion (new P3 #2): fixed. The test at review-fixes.test.ts:62-73 now:
    - issues one playback token to the tester and one to the builder;
    - confirms the tester's token works;
    - deletes the tester's account;
    - checks that both tokens return 404 and that no token rows remain.

    The builder's token goes because deleting the evidence row cascades to it. The pointless pre-deletion assertion is
    gone, and logout revocation now has its own test (:75-82).
  - Verify run: pnpm-verify.txt shows secrets 88 files clean, api 238/238 across 8 files, and EXIT=0.

  Findings

  1. [P3] The error-mapping test only checks the response. lifecycle.test.ts:164-173 asserts the 500 status and code,
     not that the error was logged.
     - Fix: Run it with makeApp({ captureLogs: true }) and assert that an unhandled error line appears, so the "logged"
       part of the fix is tested.

  Carried P3: on account deletion the other party's demo-transfer history is still deleted (new P3 #3). It is
  documented in ADR 0002 and doesn't block.

✻ Cogitated for 13s · done 11:09 PM
```
