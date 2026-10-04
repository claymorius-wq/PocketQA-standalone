# Candidate: production increment 4 (operations)

**Base:** `16378f4` (increment 3). The changes are uncommitted and frozen; the reviewable set is `git diff --cached`.

**Ledger rows:** O1, O2, O4 (code), O6, O7 and O8.

**Unaffected:** the preview demo stays in development mode, with `trustProxy` off as before. `scripts/preview/*` is untouched.

## Changes

### O2: backup and restore (`apps/api/src/backup.ts`; CLIs `db:backup` and `db:restore`)
- **`backupDb`:**
  - uses SQLite's online `backup()` (consistent while the API serves, WAL included);
  - switches the copy to `journal_mode=DELETE` so it's one self-contained file;
  - mode 0600 in a 0700 directory;
  - runs `integrity_check` and requires the `schema_migrations` table;
  - returns the sha256;
  - never overwrites an existing backup.
- **`restoreDb`:**
  - integrity-checks the backup first and refuses a corrupt or foreign file;
  - **renames** the current DB and its WAL/SHM to `.pre-restore-<stamp>`, so nothing is deleted;
  - copies the backup in and re-checks it.
- **CLIs:**
  - `db:backup` refuses an output directory inside the repo.
  - `db:restore` refuses while anything answers `/health` on the configured port, so the API must be stopped.

### O1: readiness
`/health` runs `SELECT 1`. A database that can't answer gives 500.

### O4: supervision and restart
- **`server.ts`:** on SIGTERM or SIGINT it stops the sweep, then `app.close()`, which finishes in-flight requests, then `db.close()`, which checkpoints the WAL. It exits 0, or 1 on error. A second signal is ignored.
- **`scripts/production/run-api.sh`:**
  - loads `POCKETQA_ENV_FILE` only if it is outside the repo, mode 600 or 400, and sets `POCKETQA_ENV=production`;
  - then `exec`s the workspace tsx, so SIGTERM reaches Node directly;
  - `run-api.sh backup` runs a single backup.
- **`deploy/launchd/ai.pocketqa.api.plist`:** `KeepAlive`, a 10 s throttle and a 30 s exit timeout.
- **`deploy/launchd/ai.pocketqa.backup.plist`:** daily at 03:15. Both pass `plutil -lint`.

### O6: trusted proxy
- `POCKETQA_TRUST_PROXY=loopback|none`. Production defaults to `loopback` (`['127.0.0.1', '::1']` only); development defaults to `none`.
- The API binds loopback, so the only possible proxy is local.
- Without trust, `X-Forwarded-For` is ignored.

### Runbook
`docs/deploy/production-runbook.md` covers:
- host layout and the env file, with placeholders only;
- launchd install;
- health;
- backups and the restore drill;
- upgrades and rollback;
- admins;
- what production doesn't offer.

### O7 and O8
No code change. The ledger points at the existing audits and `admin:grant`, and at `log.redact.test.ts`.

## Evidence
- **`pnpm verify`:** EXIT=0.
  - Secrets scan: 615 files. One runbook placeholder line is marked `check-secrets: allow`.
  - Test counts: scripts 44, contracts 17, domain 170, API 368 plus 2 skipped, mobile 729.
- **New API tests:**
  - **`backup.test.ts`:**
    - an online backup of a live WAL DB with uncheckpointed writes;
    - mutate, then restore, and the backup state returns;
    - the pre-restore copy keeps the newer state;
    - modes;
    - no side files;
    - corrupt or foreign files refused;
    - no overwrite.
  - **`db-scripts.test.ts`:** the CLIs, including refusing an output directory inside the repo.
  - **`operations.test.ts`:**
    - the trust-proxy config;
    - per-client limits with trust, and forged `X-Forwarded-For` ignored without it;
    - `/health` gives 500 when the DB is closed;
    - **a real server process:** register a user; `db:restore` is refused while the API runs; SIGTERM exits 0 and the port is closed; restart and log in as the same user.
- **New script tests** in `scripts/production-scripts.test.mjs`:
  - `run-api.sh` refuses a missing, loose (0644), development or in-repo env file;
  - `run-api.sh backup` succeeds with a production env file of placeholders (offline config validation; no provider calls).
- **Not done:** installing the launchd services on a production host and running the host restore drill. Both wait on host decision A7.

## Review asks
- **Restore safety.** Is the port probe enough to show the API is stopped, or should it also take a file lock?
- **Shutdown ordering.** In-flight uploads to R2 are client-to-R2 direct; any server-side risk on close?
- **The wrapper's env sourcing.** It runs `set -a` and `. file`, so the env file is executable shell. That's acceptable only because it's owner-only and outside the repo. Should it parse `KEY=VALUE` lines instead?
- **Backups.** Retention isn't automated ("never pruned"). Is that consistent with the no-deletion stance, or should a rotation policy be a decision for Hamza?

## r1 follow-ups (`inc4-verdict-qa-r1` APPROVE, all P3) and one new app fix, for r2
- **P3-2.** `db:backup` opens the live DB **read-only** (`new Database(file, { readonly, fileMustExist })`), so a backup never runs migrations. Test: `backup.test.ts` "backup never migrates the live database".
- **P3-3.** The server writes `api.pid` (0600) in the data dir and removes it on clean shutdown. `db:restore` refuses while the port answers **or** the pid file names a live process; a stale pid after a crash is ignored. Test: a real process with a restore on a different port is refused with "pid file", and the pid file is gone after SIGTERM.
- **P3-4.** `run-api.sh` parses the env file literally (`KEY=VALUE` lines, one optional pair of quotes). It never runs it as shell, and refuses junk lines. Test: `$(…)` and backtick values never run.
- **P3-5.** `db:backup`'s outside-repo check uses the real path of the nearest existing ancestor. Test: a symlink outside the repo that points into it is refused, and nothing is created in the repo.
- **P3-1.** Runbook §5 adds the post-restore re-deletion step (comparing tombstones) and a retention note. The `parent-access-actions.md` A5 entry now also covers backup retention and re-deletion. The ledger records the missing self-deletion audit row as a follow-up.
- **New (please review):** a production build that can't read `/config` used to fall back to the local-mode sign-in form ("Accounts and evidence are kept on the Pocket QA server"), seen on the emulator with the production APK. It now shows "Can't reach Pocket QA" with "Try again", which refetches config.
  - Files: `SessionProvider.tsx` (`unreachable`, `retryConnection`, gated by `PRODUCTION_BUILD`) and `sign-in.tsx`.
  - Development builds are unchanged.
  - Evidence (emulator, production APK sha256 `1ba399a6…`): `native-production-build/launch.png`.
- **N1 production prebuild.** The network config has no cleartext domains, and the manifest references it. The bundle contains the https API, no `127.0.0.1:8787` and no demo accounts. See the ledger notes.
- **Re-run:** verify EXIT=0 (API 369, scripts 45, mobile 729); Playwright 12/12; Firebase emulator E2E 4/4.

## r2 follow-ups (`inc4-verdict-qa-r2` APPROVE, all P3)
- **P3-1.** The runbook's env example has its comments on their own lines, and the secret value is left empty. A script test parses the runbook block and fails on any inline comment or non-accepted key, so the doc and the parser can't drift apart.
- **P3-2.** `__tests__/session-unreachable.test.tsx`:
  - production with `/config` failing gives `unreachable`, and retry recovers;
  - development stays in local mode and is not unreachable.
  
  "Try again" uses the refresh icon.
- **P3-3.** `run-api.sh` accepts only `POCKETQA_*` keys and `GOOGLE_APPLICATION_CREDENTIALS`; `NODE_OPTIONS`, `PATH` and `DYLD_*` are refused. Covered by a test.
- **verify:** EXIT=0 (scripts 47, API 369, mobile 731).
