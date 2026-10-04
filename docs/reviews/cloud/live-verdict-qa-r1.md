# pqa-qa verdict, cloud activation (live) review (verbatim pane output; frozen tree 05c20c0b)

⏺ Review: cloud activation, live provider verification. Tree 05c20c0, worktree cloud-auth-wallet. This was a read-only
  review using the Read tool only, and I opened none of the excluded paths.

  I found no P0, P1 or P2 issues. Six P3s are listed below; none blocks.

  What I checked:
  - Bucket and project guards:
    - The R2 test throws in beforeAll unless the configured bucket is exactly pocketqa-evidence.
    - The Firebase test throws unless the project is exactly pocketqa-optijara (firebase.live.test.ts:40).
    - Both checks run before any client is built or any request is made.
  - Delete interception:
    - noDelete(store) replaces delete with a throw that records the attempt.
    - The same wrapped store is passed to buildApp, so it covers the raw adapter tests and the API flow, including
      completion's deleteOrQueue. A refused delete leaves a row in the storage_deletions outbox; the test asserts the
      count is 1.
    - sweepStorage isn't started in these tests, so nothing else can delete.
    - The created-objects listing matches the authorization exactly: 5 new keys, all unique, no overwrites and no
      deletions.
  - Firebase deletes nothing: it only creates users and reports their UIDs. The evidence shows it failed at
    accounts:signUp and created no users (CREATED_UIDS []).
  - Off by default: both suites use describe.skip unless POCKETQA_LIVE_R2=1 or POCKETQA_LIVE_FIREBASE=1.
    live-pnpm-verify.txt:131-132 shows API "14 passed | 3 skipped (17)" and "337 passed | 8 skipped", which is
    consistent with the emulator suite plus the two live suites being skipped.
  - Secret scanning:
    - check-secrets.mjs:59-60 forbids .cloud-local/.
    - The test check-secrets.test.mjs:74 covers .cloud-local/firebase-web.json and .cloud-local/service-account.json.
    - .gitignore:63-64 ignores .cloud-local/.
    - In verify, check:secrets scanned 539 files with no findings, and the value scan found 0 occurrences.
  - No credentials printed: credentials come only from the environment. The tests log only object keys, refused deletes
    and UIDs, and the evidence files contain no credential values.
  - User-action claims are justified by the evidence:
    - CONFIGURATION_NOT_FOUND on both the admin config and the public createAuthUri.
    - The IAM API is disabled.
    - initializeAuth is the Identity Platform route that needs billing, and correctly was not called.
    - CORS and lifecycle are bucket config changes, so they correctly wait for approval.
    - None of the claims overstates what was verified.

  P3 findings:

  1. The live suites are collected by the normal run (apps/api/vitest.config.ts:4 has no include or exclude).
     - Scenario: if a developer or CI shell has POCKETQA_LIVE_R2=1 and R2 credentials exported, pnpm verify creates
       real objects in the bucket and leaves them there. The bucket guard still applies, and deletes are still refused.
     - Fix: exclude test-live/** from the default config and run it through a dedicated test:live script, or also
       require a second confirmation variable.
  2. A failed assertion could print the presigned URL (r2.live.test.ts:137).
     - Scenario: when expect(intent.uploadUrl).toMatch(...) fails, vitest prints the whole URL. That includes the
       access key id, the signature and the expiry, and the output could be pasted into evidence.
     - Fix: assert on new URL(intent.uploadUrl).pathname instead.
  3. The bucket guard doesn't pin the account.
     - Scenario: with the account-level credentials used here, a different Cloudflare account that also has a
       pocketqa-evidence bucket would pass the guard.
     - Fix: also check the expected account id. Its value can be compared through an environment variable or a hash, so
       it never enters the repo.
  4. The Firebase runner used a person's own login.
     - Scenario: the runner turns the CLI login's refresh token into a temporary authorized_user file. That is a human
       account's credential, and the parent's authorization doesn't explicitly cover it. If the run crashes, the file
       can be left behind with a long-lived token.
     - Fix: after action 2, use the dedicated service account instead. Until then, keep the file in the scratchpad,
       remove it with trap/finally, and get the parent's explicit confirmation of this pattern.
  5. Stale lines in docs/deploy/cloud-backend.md:
     - Line 66 says firebase projects:list fails. The CLI now lists the project.
     - Line 73 says wrangler whoami is unauthenticated. R2 has now been verified live.
     - Line 101 lists the web wallet-link domain warning as a known follow-up. Increment 4 already fixed this with the
       surface: 'web' binding.
     - Fix: update or remove these three lines.
  6. Evidence files are excerpts. r2-live-test.txt and firebase-live-test.txt are redacted excerpts. That's acceptable,
     but neither says how it was produced.
     - Fix: add the exact command used (with credential values elided) and the redaction method to
       docs/verification.md.

  The account-level R2 credentials were disclosed, and production is already documented as needing a bucket-scoped
  token (action 3), so that is not a finding.

  VERDICT: APPROVE
