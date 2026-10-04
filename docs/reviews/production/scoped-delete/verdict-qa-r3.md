# pqa-qa: scoped-delete-qa-r3 (PENDING: the r2 approval is superseded)

**Status (2026-10-04):** the parent requires the **literal** A5 scope: deletion only for failed-upload cleanup and user-requested (account or recording) deletion. Automatic deletion of a successful upload's staging copy (`upload_staging`) is **not approved**.

**So `verdict-qa-r2.md` (APPROVE of `4fd0071`) no longer stands as a final approval.** It covered code that still deletes staging copies.
- At `bc27194`, the ledger's S5 row ("✅ … pqa-qa r2 APPROVE") and `docs/reviews/production/handoff/pr-body.md` must not be read as final.
- No delta implementing the literal scope existed when this note was written: HEAD `bc27194`, clean tree.

**What the re-review requires** (sent to the lead):
1. **Remove `upload_staging` entirely.**
   - No `deleteOrQueue(…, 'upload_staging')` after promotion (`evidence.ts:375`).
   - The sweep's closed-intent pass (`sweep.ts:61-67`) deletes quarantine objects only for `rejected` or `expired` intents (`failed_upload`), **never** for `completed` ones.
   - No `upload_staging` in `DeletionPurpose` or anywhere in `apps/api/src`.
2. **Account deletion must also remove the quarantine copy of the user's completed uploads** (purpose `account_deletion`). Once staging copies are retained, they are duplicates of the user's recordings. Today account deletion removes only evidence keys plus pending or completing quarantine objects, which would leave a copy behind after a user-requested deletion.
3. **Keep the failed-promotion cleanup:** the final key plus quarantine, as `failed_upload`.
4. **Tests:**
   - completion keeps the quarantine object;
   - a sweep past the TTL keeps the completed quarantine but removes rejected or expired ones;
   - account deletion removes evidence plus completed and pending quarantine;
   - foreign or unregistered objects stay untouched;
   - the bulk-symbol check stays unchanged.
5. **Live test and evidence regenerated:** the staging copy is retained after completion, and account deletion removes both copies. Docs, ledger and PR body updated: the interpretation text removed, and S5 back to pending pqa-qa.

**Verdict:** none until the delta's exact commit is reviewed.

VERDICT: CHANGES_REQUIRED
