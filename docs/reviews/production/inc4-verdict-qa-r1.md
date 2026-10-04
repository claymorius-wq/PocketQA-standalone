# pqa-qa verdict: production increment 4 (operations), r1 (security and product)

**Candidate:** the `git diff --cached` set in `.worktrees/production-readiness` (20 files, base `16378f4`), described in `inc4-candidate.md`, together with `docs/deploy/production-runbook.md`.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.
- The live preview wasn't touched. My drill used a temp data dir and port 18947, and I deleted the drill dir afterwards.

## What I ran
- **`pnpm verify` with Node v24.21.0:** EXIT=0.
  - `check:secrets` scanned 616 files with no findings.
  - Script tests: 44.
  - Test counts: contracts 17, domain 170, API 368 passed plus 2 skipped (including `backup`, `db-scripts` and `operations`), mobile 729.
  
  These match the candidate.
- **An independent drill with a real API process** (development mode, temp data dir, port 18947):
  1. Register alice: 200.
  2. **`db:backup` while the API is serving:** this wrote a mode 0600 single-file backup and printed its sha256.
  3. Register bob after the backup: 200.
  4. **`db:restore` while the API runs:** refused, "The API is answering on port 18947. Stop it before restoring.", exit 1.
  5. **SIGTERM:** exit 0. No `-wal` or `-shm` was left, so the WAL was checkpointed on close.
  6. **`db:restore`:** exit 0. The previous DB was kept as `pocketqa.sqlite.pre-restore-<stamp>`; nothing was deleted.
  7. **Restart:** alice can log in (200), and bob gets **401**, so the database really is back at the backup's state.
  8. SIGTERM again: exit 0. The port is closed.
- **`plutil -lint`** on both launchd templates: OK.

## Verified as correct
- **O2, backup and restore:**
  - The backup uses SQLite's online `backup()` and switches the copy to `journal_mode=DELETE`, so it's a single file. The file is 0600 in a 0700 directory, integrity-checked, with `schema_migrations` required, and an existing backup is never overwritten.
  - The restore integrity-checks first, refuses corrupt or foreign files, renames the current DB plus its WAL and SHM aside instead of deleting them, and re-checks afterwards.
  - The output directory must be outside the repo.
- **O1:** `/health` gives 500 when the database can't answer.
- **O4, supervision and restart:**
  - The sweep is stopped, then `app.close()` (finishing in-flight requests), then `db.close()`. A second signal is ignored.
  - In-flight R2 PUTs go straight from client to R2. A completion that's interrupted mid-sweep is idempotent: the outbox, intents and quarantine marks are durable.
  - launchd's `ExitTimeOut` of 30 s gives a bound before SIGKILL, and WAL is crash-safe.
- **The wrapper `run-api.sh`:**
  - It requires an env file outside the repo (checked by realpath with `pwd -P`), at mode 600 or 400, setting `POCKETQA_ENV=production`.
  - It `exec`s tsx, so the signal reaches Node.
  - Its refusals are tested.
- **O6, trusted proxy:**
  - Trust is limited to `127.0.0.1` and `::1`, and only in production by default.
  - `proxy-addr` takes the rightmost untrusted address, so a client-forged `X-Forwarded-For` prefix can't choose the rate-limit key behind a proxy that appends.
  - Without trust, the header is ignored (tested).
- **The runbook:**
  - It stops the service through `launchctl bootout` before a restore, so `KeepAlive` doesn't restart it mid-restore.
  - It says to copy backups off the host.
  - It runs one instance only.
  - It states that production stays blocked on A5, A1–A4 and A8.
  - The env file in it has placeholders only.

## Findings (all P3, non-blocking)

### P3-1: backups keep deleted accounts forever, and a restore brings them back
- Backups are "never pruned". A backup taken before an account deletion keeps that user's email, display name, notes and audit reasons indefinitely.
- My drill shows a restore brings back the exact earlier state. So **a restore silently undoes every account deletion made since the backup**, and could reconnect stale R2 keys.
- That conflicts with the Settings promise ("Deletion removes your media and personal details").
- Production can't start until Hamza's deletion policy (A5), so this doesn't block now.
- **Fix:**
  - Make backup retention and post-restore re-deletion part of the A5 decision. That is, a retention period, plus re-applying deletions logged since the backup.
  - Add a runbook step after restore: list the `user.deleted` audit entries newer than the backup and re-run those deletions.

### P3-2: `db:backup` opens the live database with `openDb`, which runs migrations
- `backup-db.ts` calls `openDb(file)`, which applies any pending migrations.
- If the checkout already has a newer SHA while the old API is still running (an upgrade window, or the daily 03:15 job firing mid-upgrade), the backup tool **migrates the live database under the running old API**. The backup then captures the migrated state, not the pre-upgrade one, which defeats the rollback in runbook section 6.
- **Fix:** open the source read-only for the backup, for example `new Database(file, { readonly: true, fileMustExist: true })`. `backup()` works from a read-only connection. Add a test that a backup never changes `schema_migrations`.

### P3-3: restore safety relies on a port probe
- The probe only checks the configured host and port.
- An API started with a different `POCKETQA_API_PORT`, or one still starting up, wouldn't be seen. The rename-aside design limits the damage.
- **Fix (optional):** take an exclusive lock file in the data dir. The server holds it while running, and the restore refuses if the lock is held. Or at least restate the `bootout` step in the CLI's refusal message.

### P3-4: the env file is sourced as shell
- `set -a; . file` runs the env file as code. That's acceptable at owner-only 600 outside the repo.
- But a secret containing `$`, backticks or spaces would be mangled or expanded.
- **Fix:** parse `KEY=VALUE` lines literally, as `readEnvFile` already does on the Node side, or document quoting rules in the runbook.

### P3-5: `db:backup`'s outside-repo check doesn't resolve symlinks
- It uses `resolve()`, not `realpath`, so a symlinked `--out` that points into the repo passes.
- **Fix:** `realpathSync` the parent before the check.

## Gates still not run (kept open)
- **Installing launchd and running the restore drill on the production host:** waiting on the host decision, access action A7.
- **Off-host backup copy:** this is procedural.
- **Everything from earlier increments:** access actions A1–A6 and A8, real wallets, and a physical device.

VERDICT: APPROVE
