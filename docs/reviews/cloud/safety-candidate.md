# Candidate: post-approval safety fixes (targeted review)

Base: `5f2680b` (live tests; `live-verdict-qa-r1` APPROVE). These changes are staged and **uncommitted**, waiting for this review. They follow the parent's safety correction (2026-10-04).

## What changed and why
1. **No R2 deletion (Hamza's hard rule).**
   - `apps/api/src/config.ts`: `r2.allowDelete` is true only with `POCKETQA_R2_ALLOW_DELETE=1`. It is off by default.
   - `apps/api/src/storage/r2.ts`: when it's off, `delete()` throws before any request is sent. Every caller goes through `deleteOrQueue` or the sweep, so the key is kept in `storage_deletions` and the object is retained.
     - Callers: quarantine after completion, rejected uploads, the sweep, a half-promoted crash leftover, and account deletion.
   - Tests:
     - `test/identity-config.test.ts`: off by default, on only with `1`.
     - `test/storage.test.ts`: with deletion off, after completion and a sweep past expiry, both the quarantine and evidence objects still exist and the outbox is non-empty.
     - `test/helpers.ts`: existing tests keep `allowDelete: true` against the fake S3, so the designed deletion paths stay covered.
   - **Documented consequence:** account deletion does not remove stored recordings while deletion is off. This is a decision for Hamza (deploy guide, user action 5).
2. **Lifecycle or expiry recommendations removed** from `docs/deploy/cloud-backend.md`, `docs/reviews/cloud/pr-body.md`, `live-candidate.md` and `inc3-candidate.md` (withdrawn, with a note). The ADR 0005 storage section records the deletion default.
3. **Personal Firebase token withdrawn.**
   - The scratchpad runners that used the CLI login were deleted. A by-name check found no leftover `authorized_user` or ADC file.
   - The live Firebase test's doc comment now requires the dedicated service account.
   - The exact minimal service-account setup, with no billing change, is in `cloud-backend.md` user action 2.
4. **Firebase Auth status** is from a live, read-only probe, not inferred: `GET identitytoolkit v1/projects` → `400 CONFIGURATION_NOT_FOUND` at 01:44:39Z and 01:47:22Z.

## Evidence
- `pnpm verify`: EXIT=0.
  - Secrets scan: 543 files.
  - Test counts: contracts 15, domain 170, API 339 plus 2 skipped, mobile 709.
  - Output: `live/safety-pnpm-verify.txt`.
- Credential-value scan: 7 live values (R2 and Cloudflare from both env files, Firebase web key and app id) against 544 committable files. 0 hits; values not printed.
- No R2 request was made in this change set. The object count stays at 5 created and 0 deleted.

## Review asks
- Can any production path still delete an R2 object with the flag unset? Check direct `store.delete` uses, the `noDelete` live wrapper, and the local store, which is unaffected by design.
- Is the outbox growth and retry behaviour acceptable when deletion is off? The retry is a local throw with backoff capped at 1 h, and makes no network call.
- Docs: any remaining lifecycle or expiry advice, or any claim that Firebase Auth is enabled.

## r1 fixes (after `safety-verdict-qa-r1` CHANGES_REQUIRED)
- **P2-1 (fail closed).** Both gates were added.
  - Config: r2 refuses to start without `POCKETQA_R2_ALLOW_DELETE=1` or `POCKETQA_R2_RETAIN_NONPROD=1` (synthetic only).
  - API: `EvidenceStore.canDelete` (false for r2 with deletion off, and for the live `noDelete` wrapper). `deleteMe` refuses with `409 CONFLICT_STATE`, "Account deletion is unavailable on this deployment: stored recordings can't be erased yet. Nothing was deleted.", before any change. The app already shows that message in its "Couldn't delete" notice. The Settings copy ("Deletion removes your media") stays true, because deletion either removes the media or doesn't happen.
  - Tests:
    - `identity-config.test.ts` "r2 refuses to start without a deletion policy".
    - `storage.test.ts` "account deletion fails closed": 409, the account still signs in, and the objects are unchanged.
  - The live R2 test sets `RETAIN_NONPROD=1` and `ALLOW_DELETE=0` explicitly.
- **P2-2 (bucket pin).** `R2_BUCKETS = ['pocketqa-evidence']` in `config.ts`, so any other bucket refuses startup. Loopback test endpoints are exempt.
  - Test: `blog-assets`, `pqa-staging` and `pocketqa-evidence-2` are refused.
  - Docs: only the bucket-scoped token is acceptable for the app.
  - I left out an account-hash pin in the app. It would bind the code to one Cloudflare account, and the bucket-scoped token already limits the reach.
- **P3-1:** documented that enabling deletion drains the outbox, with a reviewed key-list export required as part of the approval.
- **P3-2:** the token-creator role and the IAM Credentials API are needed only for workload identity or keyless ADC.

## r2 follow-ups
- `safety-verdict-qa-r2` APPROVE.
- Remaining P3s:
  - P3 1 and 2 (doc wording) are fixed.
  - P3 3 (show `canDelete` before the confirmation sheet) is left as a known follow-up. It only matters in synthetic `RETAIN_NONPROD` mode.
