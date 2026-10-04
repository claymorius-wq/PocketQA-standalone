# pqa-qa verdict: safety candidate, r2 (security and product)

**Scope:**
- The staged diff (`git diff --cached`) after `safety-verdict-qa-r1`.
- The "r1 fixes" section of `safety-candidate.md`.
- The parent's release criteria.

**Method:**
- Read-only `git diff --cached`, `grep` and `sed`, plus `node scripts/check-secrets.mjs` (546 committable files scanned, no findings).
- I made no live provider calls and no commits.
- I didn't read `.cloud-local/`, `.env*` (apart from the staged `.env.example` diff), `.preview*` or `preview-data`.

## r1 findings

### P2-1, misleading account-deletion success: fixed
- **Config gate:**
  - `config.ts` refuses r2 unless `POCKETQA_R2_ALLOW_DELETE=1`, or `POCKETQA_R2_RETAIN_NONPROD=1` for synthetic data.
  - Both checks match only the exact value `'1'`, and there is no implicit default.
  - Real-user cloud mode therefore can't start until Hamza approves deletion.
- **API gate:**
  - `EvidenceStore.canDelete` (in `types.ts`) is false for r2 with deletion off (`r2.ts`) and for the live `noDelete` wrapper; it is true for local.
  - `deleteMe` (`account.ts:249-252`) throws `409 CONFLICT_STATE` with "stored recordings can't be erased yet. Nothing was deleted."
  - The check runs **before** the transaction, so no rows are changed, sessions aren't revoked, and the identity provider user isn't deleted.
  - The app shows the API message in its "Couldn't delete" notice (`SettingsScreen.tsx:122`) and signs out only on success.
  - The copy "Deletion removes your media" is now accurate, because deletion either erases the media or doesn't happen.
- **Tests:**
  - `identity-config.test.ts` covers four cases: no policy, `ALLOW_DELETE=0`, `ALLOW_DELETE=1`, and the synthetic acknowledgement.
  - `storage.test.ts` "account deletion fails closed" checks:
    - the 409, and that it comes from this gate (its message matches);
    - that the account still works (`/me` gives 200);
    - that the objects are unchanged.
- **Docs:** the exact gate is in `cloud-backend.md` user action 5, the feature-flag table, ADR 0005 and `.env.example`.

### P2-2, unpinned bucket: fixed
- `R2_BUCKETS = ['pocketqa-evidence']`; any other name gives a `ConfigError` at startup.
- The exemption applies only when `POCKETQA_R2_ENDPOINT` is set. That value is already forced to `http://127.0.0.1|localhost:<port>` (`config.ts:146-148`), so the exemption can't reach real R2.
- The test refuses `blog-assets`, `pqa-staging` and `pocketqa-evidence-2`, and accepts a loopback server.
- The docs say only the bucket-scoped token may be used, never account-level or other-project credentials.
- Not adding an account-hash pin in the app is reasonable, given the bucket pin plus a bucket-scoped token.

### P3-1, backlog drain: fixed
- User action 5 documents the drain (500 keys per sweep), and that dispute-relevant quarantine copies are included.
- It requires a reviewed `storage_deletions` key-list export as part of approval.

### P3-2, token-creator role: fixed
- The token-creator role and the IAM Credentials API are now stated as needed only for workload identity or keyless ADC.

## Rechecked against the hard rules
- **R2 deletion:**
  - The only `DeleteObjectCommand` in `apps/api/src` is `r2.ts`, and it is still refused before any request while the flag is unset.
  - The only `DELETE FROM evidence` is in account deletion, which is now gated.
  - No lifecycle or expiry advice remains; `cloud-backend.md` R2 setup step 5 explicitly forbids it.
- **Personal tokens:** none are used or advised. The service-account setup is minimal: Firebase Auth Admin only, with token creator on itself only and only when there's no key.
- **Firebase Auth:** not claimed enabled anywhere; the status is still `CONFIGURATION_NOT_FOUND`.
- **Billing:** no billing change.
- **Live R2 test:** it sets `RETAIN_NONPROD=1` and `ALLOW_DELETE=0` explicitly, and keeps both its bucket pin and its account pin.
- **Evidence:** `safety-pnpm-verify.txt` has EXIT=0, with API 342 passed and 2 skipped, mobile 709, domain 170 and contracts 15. The staged files contain no secrets.

## Remaining (P3, non-blocking)
1. **Stale gate-check wording.** In `docs/deploy/cloud-backend.md`, the R2 gate-check bullet says account deletion with deletion off leaves "objects retained and listed in the outbox". With the new gate it is refused with 409, and nothing is queued.
   - Fix: reword it to "refused (409); objects unchanged".
2. **Contradictory ADR wording.** ADR 0005's storage bullet still says the object is retained "including on account deletion". The sub-bullet immediately below says account deletion fails closed.
   - Fix: drop "including on account deletion" from the first sentence.
3. **The refusal comes late in the UX.** With `RETAIN_NONPROD=1`, a user only learns that deletion is unavailable after typing the confirmation phrase.
   - Fix: optionally expose `canDelete` through `/config` and disable the button, with the explanation shown up front. Export stays available.

## Verdict
P2-1 and P2-2 are closed with tests, and both P3s are documented. The parent's criteria are met:
- no misleading deletion success;
- fail closed through the config gate and the API gate;
- real-user cloud mode is off pending Hamza's policy;
- unrelated buckets can't be targeted.

VERDICT: APPROVE
