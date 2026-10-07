# pqa-qa: real-run migration review r1 (`0f5587c`, `scripts/migrate-to-firestore.ts --real`)

**Method:** read-only. I read all of `realRun`, `main`, `s3ObjectStore`, `r2FromEnv`, `planMigration` (the users and evidence parts) and `applyPlan`, plus `storage/sweep.ts` to check how deletion could interact with it.

## What holds
- **Approved inputs only:**
  - `--real` needs `--approved-manifest`;
  - the real project accepts **only** snapshot `3501bc9e…`, refuses `FIRESTORE_EMULATOR_HOST`, and refuses a test R2 endpoint;
  - the receipt is never read from `.preview`, and the bucket must equal the receipt's bucket.
- **Manifest gate before any write:** the in-memory planned manifest must be `ok` **and** equal the approved `686c435d…`.
- **Read-only pre-check:** it refuses on any unplanned user and on any planned document that exists with different content.
- **Objects:**
  - writes go only to `^evidence/[A-Za-z0-9_-]{8,64}$`;
  - a copy is allowed **only** from `^retained-local-submissions/…/<sha>.mp4$` and only from the receipt key, after a HEAD-size check against the receipt;
  - local uploads are re-hashed against the plan, and the PUT goes through a presigned URL with signed type and length;
  - **after each write: HEAD size plus a full-GET sha256**, and only then registration in `storageObjects`;
  - an existing target with different content stops the run;
  - **the store has no delete method.**
- **The archive key:** it's never a target and never registered. The sweep only deletes for explicit reasons (intent expiry, account deletion, outbox), behind the A5 gate (an app key shape that's registered). There's no orphan scan, so a partial run can't make the sweep delete anything.
- **Documents:** written with `set` of deterministic content, so a rerun is identical. The post-run manifest is **read back** from Firestore and must equal the approved one (exit 1 otherwise). The snapshot is re-hashed afterwards.
- **Output:** counts only; the report and manifest files are 0600 and outside the repo.

## P2-M1: a live sign-up can be overwritten between the pre-check and the writes
- **The race:** the hosted site is **live with self-registration open**. `realRun`'s pre-check reads the target, then (after the object copies, which take time) `applyPlan` writes everything with **`set`, which overwrites**. Suppose someone registers in that window with an email the migration also plans; the obvious candidate is **Hamza signing up with his own address** before his migrated account is linked. Then `userEmails/{sha(email)}` is overwritten to point at the migrated user, and the new account's email guard is lost (UNIQUE(email) broken). That user's uid stays mapped to the new, empty account, so the §7(a) claim of the migrated account is refused (identity already mapped), and the Seeker submission is separated from its owner until an admin fixes it by hand.
- **Required** (either):
  - **(a) preferred:** `applyPlan` never overwrites. Per document, `create`; if it already exists, compare it canonically, treat identical as an ok no-op, and **abort** on a difference before writing more (a transaction or a `create`-based batch with a fallback compare). Add an emulator test: a user registers with a planned email after the pre-check, and the run aborts without changing that user's `userEmails`.
  - **(b):** a maintenance switch that refuses self-registration and identity sessions during the run, turned on before and off after, with evidence.
- **Operationally:** ask Hamza **not to sign up on https://pocketqa.vercel.app until the migration is done**, so the claim links his migrated account.

## P3
1. **A report on a mid-run stop.** If objects are registered but the run stops before `applyPlan`, there are `storageObjects` without evidence documents. That's harmless (no orphan deletion) and a rerun completes it. Record any such stop in the report: `objects.failed` and the counts are already written. Good.
2. **Run checklist:** the R2 credentials come from the environment, so run it with the **production** values via a scoped shell, not exported globally, and print the report path only.

## Verdict
**CHANGES_REQUIRED** (P2-M1) before the real run. Everything else is approved as written. After the fix: I'll re-review the diff and run the new emulator test. Then the lead runs it, and I do the post-run check:
- the read-back manifest equals `686c435d…`;
- hosted counts;
- the Seeker sha `3ee5d78c…` matches on a presigned GET by its owner, and an unrelated tester is denied.

## r2: P2-M1 at `b8018ae`
**The change:**
- **No overwrites:** the real run writes **every** document through `createOrCompare`. It calls `create()`; on `ALREADY_EXISTS` (code 6) it re-reads the document and compares it canonically. Identical is a no-op; different **aborts** with the document untouched, and the report names the conflicting collections.
- **`set()` is dry-run only:** `applyPlan` (`set`) is used **only** in the emulator dry-run branch (`main`, the non-`--real` path).
- **Order:** manifest gate, then read-only pre-check, then users, guards and every document not tied to an object, then the object copies (verified, then their `storageObjects` registered through `createOrCompare`), then the evidence documents. So no evidence document ever points at a missing object.

**My run** (detached `.worktrees/qa-fv-run` at `b8018ae`, my emulator ports):
- `studies.migration-real.test.ts` + `studies.migration.test.ts`: **15/15**.
- **My own mutation** (`create` changed back to `set` in `createOrCompare`): the real-run tests go **2 failed / 7 passed**, so the live-sign-up race test and the overwrite guard bite. Restored; the tree is clean.

**Residual (P3, accepted):** a conflict aborts mid-way, so earlier chunks stay created. For example, a migrated user document can exist without its email guard if the guard conflicted. That's safe:
- the §7(a) claim reads the guard and returns null, so nothing is merged;
- the sweep has no orphan deletion;
- the report records the stop.

Resolution is manual, then a rerun (idempotent).

**Verdict:** P2-M1 is **fixed**. **APPROVE `b8018ae` for the real run** against `pocketqa-optijara` and R2, on these conditions:
1. Inputs: the approved snapshot `3501bc9e…`, the receipt, and `--approved-manifest 686c435d…`.
2. Production credentials only in a scoped shell.
3. Hamza does **not** sign up on the live site until the run has finished.
4. Afterwards, the lead sends me the report and the post-run manifest hash. Then I run **my post-run check**:
   - the post-run manifest equals `686c435d…`;
   - hosted counts and relations;
   - the Seeker evidence plays with sha `3ee5d78c…` for its owner, and an unrelated tester is denied.
