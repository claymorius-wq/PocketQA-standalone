# Phase 0 foundation — independent-qa targeted re-review (post-approval P3 fixes)

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-02.

```text
⏺ VERDICT: APPROVE

  All three fixes are in the files, checked with Read only; I modified nothing. I couldn't re-run the tests myself.

  - (a) Email normalization: fixed. index.ts:56 now trims and lowercases before checking the email format, and the
    comment on line 55 says why. The new test at index.test.ts:40-45 checks that '  A@Example.COM ' comes out as
    'a@example.com'.
  - (b) MWA release date: fixed. dependency-versions.md:47 now gives 2026-08-17, which matches
    evidence-registry.txt:201. It explains the 2026-10-01 timestamp and restates the rule: no canary or under-7-day
    release without a recorded reason.
  - (c) Annotation disclosure: fixed. verdict-qa-r1.md:3 now discloses the one bracketed lead annotation on line 15.

  Findings:

  1. [P3] docs/verification.md doesn't show the red→green run for the email test. Its latest pnpm verify capture is
     still the round-2 run with "Tests 13 passed" (verification.md:57-62). The failing run ("expected false to be
     true") and the passing "Tests 14 passed" run appear only in the lead's message.
     - Fix: Before the initial commit, paste both outputs verbatim, or re-run pnpm verify and paste that, so the log
       matches the tree being committed.
  2. [P3] The accepted-risk note at 0001-architecture.md:87 is out of date. It still says the release-age guard is
     "deferred to Phase 6" and doesn't mention the restated rule.
     - Fix: Point it at the rule in dependency-versions.md:47.

  I agree the other P3s (exact evidence commands, encoded-path redaction, scanner policy for explorer URLs, builder
  dispute view, SIWS domain) can move to later phases. None of them blocks the initial commit.

✻ Worked for 13s · done 10:43 PM
```
