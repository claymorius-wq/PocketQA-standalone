# Production runbook (Pocket QA API)

> Not live yet. Production can't start until the acceptance ledger's gates are closed (`docs/production/acceptance-ledger.md`). In particular:
> - **A5 (decided 2026-10-04):** production runs with `POCKETQA_R2_ALLOW_DELETE=1`, which means Hamza's scoped policy: only objects Pocket QA created itself (registered in `storage_objects`), only in `pocketqa-evidence`, only for failed-upload cleanup and user-requested account deletion; no time-based expiry of evidence, no lifecycle rules, no other bucket. Removing the temporary quarantine copy of an upload that succeeded (`upload_staging`; the recording stays as `evidence/<id>`) is the **lead's interpretation** of that decision, a temporary app-made duplicate. pqa-qa considers it inside the decision's spirit. It is **pending Hamza's or the parent's confirmation**; if the decision is read literally, stop the two `upload_staging` calls and keep those copies.
> - **A1/A2:** Firebase Auth and the service identity.
> - **A3:** the bucket-scoped R2 token.
> - **A4:** the production origin.
>
> Nothing in this runbook changes the live demo preview.

## 1. Host layout
| Item | Location | Notes |
|---|---|---|
| Code | a checkout of an exact reviewed SHA | Install with `pnpm install --frozen-lockfile`, on Node 24 (`engines`). |
| Env file | e.g. `/etc/pocketqa/production.env` | **Outside the repo, mode 600.** `run-api.sh` refuses anything else. It's read literally as `KEY=VALUE` lines, never run as shell, with one optional pair of quotes. |
| Data dir | `POCKETQA_DATA_DIR`, e.g. `/var/lib/pocketqa` | Outside the repo; production refuses a data dir inside it. Never `preview-data`. |
| Backups | `POCKETQA_BACKUP_DIR`, e.g. `/var/backups/pocketqa` | Outside the repo. Copy them off the host as well. |
| Logs | `__LOG_DIR__` in the plists | Method, redacted path and status only. No headers, bodies or tokens. |

## 2. The env file (`production.env`)
One `KEY=VALUE` per line. Comments go on their own lines starting with `#`. Values are taken literally, with no inline comments. Only `POCKETQA_*` keys and `GOOGLE_APPLICATION_CREDENTIALS` are accepted.
```sh
POCKETQA_ENV=production
POCKETQA_DATA_DIR=/var/lib/pocketqa
POCKETQA_BACKUP_DIR=/var/backups/pocketqa
POCKETQA_AUTH_MODE=firebase
POCKETQA_FIREBASE_PROJECT_ID=pocketqa-optijara
# public identifier, from the Firebase web app
POCKETQA_FIREBASE_WEB_API_KEY=<public web key>
# dedicated SA key (A2), mode 600; never a personal token
GOOGLE_APPLICATION_CREDENTIALS=/etc/pocketqa/pocketqa-api.json
# A4
POCKETQA_PUBLIC_ORIGIN=https://<production origin>
POCKETQA_STORAGE=r2
POCKETQA_R2_ACCOUNT_ID=<32 hex>
# pinned in code; anything else refuses to start
POCKETQA_R2_BUCKET=pocketqa-evidence
# A3; never account-wide credentials
POCKETQA_R2_ACCESS_KEY_ID=<bucket-scoped token id>
# the bucket-scoped secret goes here (never in a document)
POCKETQA_R2_SECRET_ACCESS_KEY=
# the scoped deletion policy (A5, decided 2026-10-04); production refuses to start without it
POCKETQA_R2_ALLOW_DELETE=1
# POCKETQA_WALLET_LOGIN=1 and POCKETQA_WALLET_LOGIN_RISK_ACCEPTED=1 ONLY after A8 is recorded
```
With this file:
- Production trusts the loopback proxy by default (`POCKETQA_TRUST_PROXY=loopback`).
- The API still binds `127.0.0.1` only. The TLS endpoint is a local reverse proxy or tunnel in front of it.

## 3. Process supervision (launchd)
1. Copy `deploy/launchd/ai.pocketqa.api.plist` and `ai.pocketqa.backup.plist` to `~/Library/LaunchAgents/`, or to `/Library/LaunchDaemons/` for a system service.
2. Replace the placeholders: `__REPO__`, `__ENV_FILE__`, `__LOG_DIR__`, `__NODE_BIN_DIR__` (the Node 24 `bin` directory).
3. Check and load:
   ```sh
   plutil -lint ~/Library/LaunchAgents/ai.pocketqa.*.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.pocketqa.api.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.pocketqa.backup.plist
   ```
4. How it behaves:
   - `KeepAlive` restarts the API if it exits, throttled to 10 s.
   - On `launchctl bootout` (stop), launchd sends SIGTERM. The API stops taking requests, finishes the ones in flight and closes the database (checkpointing the WAL), then exits 0. This is tested with a real process in `apps/api/test/operations.test.ts`.
   - A restart resumes from durable state on the next storage sweep: upload intents, the deletion outbox and the quarantine marks.
5. **Run one instance only.** Rate limits and the storage sweep live in the process.

## 4. Health
`GET /health` answers 200 only if the database can answer a query, so it is a readiness check, not just a liveness check. Point the tunnel's or uptime monitor's health check at it through the proxy.

## 5. Backups and the restore drill
- **Retention:** backups contain deleted users' data until they are removed. How long backups are kept is **still open** (not part of the A5 R2 decision). Until it is decided, nothing is pruned.
- **Daily:** `ai.pocketqa.backup` runs `run-api.sh backup` at 03:15. It takes an online, consistent snapshot through SQLite's backup API while the API is serving. The snapshot is a single file at mode 600, integrity-checked, and the job prints its sha256. Backups are **never pruned automatically**.
- **Ad hoc:** `pnpm --filter @pocket-qa/api db:backup -- --out <dir outside the repo>`.
- **Restore drill** (run it before go-live and after each upgrade, and record it in `docs/verification.md`):
  1. Stop the API: `launchctl bootout gui/$(id -u)/ai.pocketqa.api`.
  2. `pnpm --filter @pocket-qa/api db:restore -- --from <backup file>`. This refuses while anything answers on the API port or while the API's pid file names a live process, and refuses a corrupt or foreign file. It renames the current database and its WAL/SHM to `.pre-restore-<stamp>` and keeps them.
  3. **Re-apply account deletions made since the backup** (inc4 review P3-1). A restore brings back accounts deleted after the backup was taken. Deleted accounts remain as tombstones (`users.status = 'deleted'`). Compare `SELECT id FROM users WHERE status = 'deleted'` in the kept `.pre-restore-<stamp>` database with the restored one, and repeat the deletion for every account that is deleted there but not in the restored copy, before reopening the API to users. `pnpm --filter @pocket-qa/api db:deleted-since -- --pre-restore <kept file>` lists them, reading both files only. If restores repeat, compare against the **original** pre-restore file, the one from the first restore after the deletions, not only the latest one (inc5 review P3-1). This step and backup retention are still open decisions for Hamza; the A5 decision covers R2 objects only.
  4. Start the API, then check `/health` and a known record.
  
  The drill is tested in `apps/api/test/backup.test.ts` and `db-scripts.test.ts`.
- R2 objects are not part of the database backup. Bucket objects are deleted only under the scoped policy (A5): objects this database registered, for failed uploads and account deletion, plus staging copies (the lead's interpretation, pending confirmation; see the top of this runbook). There are no lifecycle rules and no bulk or admin purge. After a restore, objects registered only in the newer database are no longer known to the restored one, so they can't be deleted by it. List them for Hamza; don't delete them by hand.

- **Turning deletion on over an older database** (scoped-delete review P3-1): a database that ran retention-only may hold outbox rows (purpose `unrecorded`) for its own registered keys. The first sweeps after `POCKETQA_R2_ALLOW_DELETE=1` delete them. Review `SELECT object_key, purpose FROM storage_deletions` before switching. The production database starts fresh, so this doesn't apply at launch.
- **Uploads never completed** (review P3-2): an intent that expires before `complete` is failed-upload cleanup, even if its bytes arrived. The app's retry starts a new intent and uploads again.

## 6. Upgrades and migrations
1. Take a backup (section 5).
2. Check out the new reviewed SHA, then run `pnpm install --frozen-lockfile`.
3. Restart the API service.
   - Migrations are append-only and run once at start (`schema_migrations`).
   - A shipped migration is never edited.
4. **Rollback:** stop the API, check out the previous SHA, restore the pre-upgrade backup, then start the API.

## 7. Admins
- No admin is seeded and there is no public admin identity.
- The person signs up in the app and verifies their email. Prefer Google with 2-step verification, because admin MFA is a residual risk.
- The operator confirms who the person is out of band, then runs on the host:
  ```sh
  pnpm --filter @pocket-qa/api admin:grant <email> --reason "<why>"
  ```
- The grant is audited (`user.admin_granted`) and visible in the admin audit view.

## 8. What production does not offer (by design)
- Test-credit top-ups and devnet demo transfers. They are refused with `FEATURE_UNAVAILABLE` and hidden in the app.
- Real payments, payouts, mainnet and billing. Each needs separate approval.
- AI analysis while no provider is configured. It is shown as unavailable and never faked.
