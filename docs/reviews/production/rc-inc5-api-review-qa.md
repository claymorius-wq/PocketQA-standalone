# pqa-qa: interim review of increment 5 API changes (dirty tree, not a freeze verdict)

**Date:** 2026-10-04, around 13:40Z.

**Scope:** the lead's working tree at `.worktrees/production-readiness`, `HEAD 94774d1` plus uncommitted changes. This covers only the increment 5 **API** changes:
- the `user.deleted` audit row in `deleteMe`;
- `deletedSince` and `db:deleted-since`;
- `src/storage/cors.ts` and `scripts/r2-cors.ts`.

**What this is not:**
- The merge `06c09b3..94774d1`, the Lens UI fixes and the native crash work are **not** covered.
- This is **not** an approval of any candidate. The parent requires a fresh final review of the exact frozen commit after the native fixes. Earlier approvals, including `freeze-verdict-qa-r1`, don't cover the new candidate.

**Rules held:**
- Read-only: no edits to implementation files and no index changes.
- No cloud calls. I did not run `r2:cors`, even as a dry run.
- No shared emulator and no ports.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.
- No subagents and no advisor.

## What I ran
- **Targeted unit tests, no servers** (`apps/api`, Node v24.21.0): `npx vitest run test/cors.test.ts test/backup.test.ts test/account.test.ts`. Result: 3 files and 13 tests passed.
- **A crash reproduction in my scratchpad**, deleted afterwards. It imported the worktree's `src/db.ts` and `src/backup.ts` without changing them:
  1. Create a DB with users `u-before` and `u-after`, then checkpoint.
  2. `backupDb` succeeds.
  3. Set `wal_autocheckpoint = 0`, then `UPDATE users SET status='deleted' WHERE id='u-after'`.
  4. Call `process.exit(0)` **without** `db.close()`. This simulates a crash; the data dir now holds `pocketqa.sqlite`, `-wal` and `-shm`.
  5. `restoreDb(backup)` kept the old files as `pocketqa.sqlite.pre-restore-<stamp>`, `pocketqa.sqlite-wal.pre-restore-<stamp>` and `pocketqa.sqlite-shm.pre-restore-<stamp>`.
  6. **`deletedSince(pre-restore main file, restored DB)` returned `[]`.** But `u-after` was deleted before the crash and is **active again** in the restored DB.
  7. Opening the pre-restore file "read-only" also created new `…pre-restore-<stamp>-wal` and `-shm` files next to it.

## Findings

### P2-1: after a crash, `db:deleted-since` misses deletions that were still in the WAL, and reports that no deleted accounts came back
- **Where:**
  - `apps/api/src/backup.ts`, in `restoreDb`: it renames the `-wal` and `-shm` sidecars to `pocketqa.sqlite-wal.pre-restore-<stamp>`, which is not the `<file>-wal` name SQLite looks for.
  - `deletedSince`: it opens the pre-restore main file without its WAL.
- **Scenario (reproduced above):**
  - The API runs in WAL mode, and recent writes, including account deletions, sit in the WAL until a checkpoint.
  - A restore is usually done after a crash or corruption, so those WAL contents are exactly the ones at risk.
  - The tool prints "No deleted accounts came back with the restore." and the runbook step then reopens the API with those deleted accounts **resurrected**: their email, display name and notes come back.
- **Why this blocks:** this is a false assurance on the account-deletion promise. The tool exists specifically to answer inc4 P3-1, as part of A5.
- **Side effect:** the kept-aside database also can't be opened as it was. Its newest data is in a WAL under a name SQLite won't pick up, so an operator rolling the restore back would silently lose those writes unless they rename the files by hand.
- **Fix:**
  - In `restoreDb`, move the trio with SQLite's naming: `X = pocketqa.sqlite.pre-restore-<stamp>`, then `-wal` → `X-wal` and `-shm` → `X-shm`. Opening `X` then includes its WAL.
  - Alternatively, or as well: before moving anything, open the old DB and run `PRAGMA wal_checkpoint(TRUNCATE)`. That writes but deletes no data.
  - Add a test that reproduces the un-checkpointed WAL: a child process that updates and exits without `close()`, then `restoreDb` and `deletedSince` must list the user.
  - Optionally, open the pre-restore file with `?immutable=1`, or copy it to a temp dir first, so the "read-only" tool creates no new side files.

### P3-1: `deletedSince` only compares against the most recent pre-restore file
- If two restores happen in a row, the second pre-restore file is the first restored DB, which had already lost deletions.
- **Fix:** document "compare against the **original** pre-restore file". Alternatively, drive the tool from `user.deleted` audit rows, which the new `deleteMe` writes, across all kept files.

### Checked, no defect
- **The `user.deleted` audit row in `deleteMe`:**
  - It is in the same transaction, after the redaction step.
  - It has fixed text and no personal data; the actor and target are the user's id.
  - The user row is kept (status `deleted`), so the actor id stays valid.
  - It is covered by a test.
- **`corsRules` and `planCors`:**
  - The rule is one exact https public origin (`isPublicHost`, `u.origin === origin`, no `*`), `PUT` only, `AllowedHeaders: ['content-type']` and max age 3600.
  - That matches the presigned PUT, which sends only the `content-type` header (`r2.ts:72`); content-length is set by the browser and isn't preflighted.
  - Playback goes through the API, so no GET or expose headers are needed.
  - `conflict` never overwrites someone else's rules: `PutBucketCors` replaces the whole configuration.
  - It is covered by `cors.test.ts`.
- **`r2-cors.ts`:**
  - It is a dry run by default.
  - It refuses any bucket outside `R2_BUCKETS`.
  - Credentials come from the environment and are never printed.
  - It reads back after `--apply`, has no object operations and no delete calls.
  - **Note for the apply step (a parent or lead action, not mine):** run it with the authorized credentials only after the origin is final. Record the before and after readback in `docs/verification.md`.

## Re-review r2 (lead's fix, dirty tree on `94774d1`, around 13:55Z)

**The change:**
- `restoreDb` now moves the DB, WAL and SHM to `<aside>`, `<aside>-wal` and `<aside>-shm`.
- It refuses an existing `<aside>`.
- It then opens the kept copy and runs `wal_checkpoint(TRUNCATE)` and `journal_mode = DELETE`.
- The new test "restore after a crash keeps un-checkpointed writes" uses a real child process that exits without `close()`.

**What I ran (no servers, no emulator):**
- `npx vitest run test/backup.test.ts test/db-scripts.test.ts test/account.test.ts test/cors.test.ts`: 4 files, 15 tests passed.
- **My scratch crash reproduction, against the new code:**
  - `deletedSince` now returns `["u-after"]`. Before the fix it returned `[]`.
  - The data dir holds exactly `pocketqa.sqlite` and `pocketqa.sqlite.pre-restore-<stamp>`, with no stray sidecars.
  - **P2-1 is fixed.**
- **A new probe: restoring over a corrupt live DB.** I wrote an 8 KiB garbage file as `pocketqa.sqlite`, then called `restoreDb`.
  - The first try **threw `file is not a database`**, from `kept.pragma(...)`, *after* the rename. The data dir was left with only `pocketqa.sqlite.pre-restore-<stamp>` and **no `pocketqa.sqlite`**.
  - A second try succeeded, because the DB is now missing and nothing is moved aside.
  - The scratch files were deleted.

### P2-2 (new, from the fix): restoring over a corrupt database fails partway and leaves no database
- **Where:** `restoreDb`, where `new Database(aside)` and `wal_checkpoint` run after the rename with no error handling.
  - The error is a `SqliteError`, not a `BackupError`, so `db:restore` rethrows it as a raw stack trace (`restore-db.ts:28`).
- **Scenario:**
  1. Corruption is the main reason to restore.
  2. The operator runs `db:restore` and gets a stack trace. The live DB has been moved aside, and nothing has been restored.
  3. If they then start the API, as runbook step 3 says, `openDb` silently **creates a fresh empty database**.
  4. Users would then see an empty service, and new sign-ups would land in a database that diverges from the real one.
- **Fix:**
  - Wrap the checkpoint of the kept copy in try/catch. On failure, leave the trio under its sidecar names (still replayable later) and **continue the restore**, reporting that "the kept copy could not be checkpointed (it may be corrupt)".
  - Add a test with a corrupt live DB.
  - Optionally have the API refuse to start in production with no DB when a `.pre-restore-*` file exists. This is a cheap guard against "fresh empty DB after a failed restore".

### P3-2: the runbook's re-deletion step has no operator tool
- Runbook §5 step 3 says to "repeat the deletion" for each id that `db:deleted-since` lists.
- But account deletion exists only as `DELETE /me` with the user's own token. There is no host CLI. An operator would have to hand-write SQL that mirrors the redaction, media and outbox logic in `deleteMe`, which is error-prone.
- If the kept copy is corrupt (see P2-2), `db:deleted-since` can't read it at all. The source then has to be the `user.deleted` audit rows in another backup or the logs.
- **Fix:** before A5 closes, add a `db:redelete <id>` host CLI that reuses the `deleteMe` transaction, with a test. Document the fallback when the kept copy is unreadable.

**r2 result:** P2-1 is fixed and verified. **The new P2-2 blocks.** P3-1 is addressed in the runbook. P3-2 is open and advisory, but tied to A5.

## Re-review r3 (lead's P2-2 fix and startup guard, dirty tree on `94774d1`, around 14:10Z)

**The change:**
- `restoreDb` wraps the open and checkpoint of the kept copy in try/catch. On failure it keeps the files, adds a `warnings` entry ("could not be opened… was not checked for deletions to re-apply") and **goes on with the restore**.
- `db:restore` prints the warnings and never shows a stack trace.
- `unfinishedRestore(dataDir)` runs in `server.ts` before `openDb`. With no `pocketqa.sqlite` but a `.pre-restore-*` copy present, the API exits 1 instead of creating an empty DB.
- New tests:
  - "restore over a corrupt live database";
  - "the API refuses to start on a data dir left with only pre-restore copies".

**What I ran (no servers, no emulator):**
- `npx vitest run test/backup.test.ts test/db-scripts.test.ts test/account.test.ts test/cors.test.ts`: 4 files, **17 tests passed**.
- **Scratch probes**, all deleted afterwards:
  - **Garbage live DB (8 KiB) plus a garbage `-wal`:** the restore succeeds, the live DB is present and the kept copy is listed. Warning: "The previous database could not be opened (file is not a database); it is kept unchanged…". **P2-2 is fixed.**
  - **`unfinishedRestore`:**
    - after a successful restore, it gives `null`;
    - with a dir holding only `pocketqa.sqlite.pre-restore-x`, it gives the "Finish the restore" message;
    - on a fresh, empty, non-existent dir, it gives `null`, so first start isn't blocked.
  - **The real `src/server.ts`** with `POCKETQA_DATA_DIR` holding only a pre-restore copy: it printed the guard message and **exited 1 before `listen`**, and created no DB. The dir afterwards held only `pocketqa.sqlite.pre-restore-x`.
  - **A garbage main DB plus a *valid* WAL with real frames:** SQLite opened it and checkpointed, with no warning. The kept copy is one file, and the WAL content was written into it rather than lost.
  - **A garbage main DB plus a *garbage* WAL:** the unusable WAL is gone afterwards, removed by SQLite on close. It's not listed, and nothing recoverable was in it.

### P3-3: the kept copy isn't truly "unchanged" when it's corrupt
- Opening the kept copy can change it:
  - a successful checkpoint rewrites a damaged main file with the WAL frames;
  - SQLite silently discards an invalid WAL on close.
- So the warning's "kept unchanged" isn't strictly true, and the forensic original is altered.
- **Fix (optional):** copy the trio raw (for example `…pre-restore-<stamp>.raw`, plus `-wal` and `-shm`) before opening the kept copy, or open a temp copy. Then the operator always has the byte-exact original.
- Not blocking: no data that SQLite could recover is lost.

**r3 result for this API slice: APPROVE (interim).**
- P2-1 and P2-2 are fixed and verified.
- P3-1 is addressed in the runbook.
- P3-2 (`db:redelete`) and P3-3 are advisory and tied to A5.
- **This is not a release verdict.** The full review of the exact frozen candidate is still required.

## Status
**REPORTED TO LEAD:**
- P2-1 was fixed in r2, and P2-2 was fixed in r3.
- P3-2 and P3-3 are advisory.
- This interim API slice is APPROVE as of r3. I'm waiting for the frozen candidate. **No verdict on the release candidate.** I'll do a fresh final review of the exact frozen commit once the lead freezes it after the native fixes.
