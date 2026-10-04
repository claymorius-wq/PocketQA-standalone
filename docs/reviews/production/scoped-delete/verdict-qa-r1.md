# pqa-qa verdict: scoped-delete-qa-r1 (independent security review of the A5 deletion candidate)

**Candidate:** code `2adea53`, evidence and docs `bd791af`, on `feat/web-launch-e2e`.
- Reviewed `git diff 2a7e98c..bd791af`: 17 files.
- This is a new candidate. My web-launch approvals don't cover it.

**Rules held:**
- Read-only, and no other file changed.
- **No R2 or Firebase contact:** I didn't run the live test.
- No subagents and no advisor.

**The scope I held the code to** (Hamza, A5, 2026-10-04, through the parent):
- delete only Pocket QA's own app-managed objects in `pocketqa-evidence`;
- only for failed-upload cleanup and user-requested recording or account deletion;
- no automatic expiry, no other bucket, no bulk or admin purge, no lifecycle;
- historical fixtures are not deleted gratuitously;
- backup policy untouched.

## What I ran (Node v24.21.0, `apps/api`)
- **`npx vitest run test/storage.test.ts`, five times:** 21/21 every time, with the 6 new scoped-deletion tests among them.
- **`npx vitest run test/storage.test.ts test/account.test.ts test/backup.test.ts test/evidence.test.ts`:** 4 files, 40/40.
- **Secret scan of `live/r2-scoped-delete.txt`, `live/prod-start-smoke.txt` and `scoped-delete/pnpm-verify.txt`:** 0 JWT `eyJ…`, 0 `X-Amz-Signature` or `X-Amz-Credential`, 0 `Bearer …`, 0 `AIza` or `AKIA`, 0 32-hex.

## 1. Migration 4 and registration (`apps/api/src/db.ts:231-247`)
- **`storage_objects(object_key PK)`.** Rows are never removed. That's correct, because a still-valid presigned URL can recreate a deleted quarantine object, and the sweep must stay allowed to remove it.
- **The backfill registers only keys this database created:**
  - `upload_intents.object_key`, which is `quarantine/<server id>`;
  - `evidence/<evidence_id>` from intents;
  - `evidence.storage_key`.
  
  It is idempotent (`INSERT OR IGNORE`), and the outbox gains `purpose` with the default `'unrecorded'`.
  - The production DB is fresh, so the backfill there is empty.
  - **Historical bucket fixtures were never in any persistent DB, so they can never become deletable.** That satisfies "not deleted gratuitously" by construction.
  - Test: "migration 4 registers the objects an existing database already created".
- **Registration happens before the R2 write:**
  - **Intent:** `registerObject` runs in the same transaction as the intent insert, before any presigned URL is issued (`evidence.ts:279-280`). The key is `quarantine/${id}` with a server-generated id (`evidence.ts:263`).
  - **Promotion copy:** `evidence/<evidenceId>` (a server id) is registered before `store.copy` (`evidence.ts:342-343`).
  - **Local multipart upload:** the key is a bare server `newId()`. It's registered in the transaction **after** the local file write (`evidence.ts:153`), and the failure path `rmSync`s the local file. That's local disk only, and the route is refused in r2 mode (`evidence.ts:87`). It fails safe, since an unregistered file is never deleted by the app, but it isn't strictly "before the write" (P3-3).
- **No client-chosen key can be registered,** and none can be deleted. Every key comes from server ids or DB rows, `assertKey` limits the shape, and the R2 adapter adds the prefix check.

## 2. `deleteOrQueue`, `ownsObject` and the sweep (`apps/api/src/storage/sweep.ts`)
- **Unregistered keys** return `false` before any delete or queue. The outbox pass **drops** an unregistered row instead of acting on it.
  - Tests: "an unregistered key is never deleted or queued, even when a caller names it", including a foreign key planted in the outbox.
  - "Objects the app did not create survive rejection, completion, the sweep and account deletion" uses planted `evidence/…`, `quarantine/…` and `blog/asset.png` fixtures. They are byte-identical afterwards.
- **Purposes:** `failed_upload` (rejected, abandoned, or crashed mid-promotion), `upload_staging` and `account_deletion`. Each queued deletion records its purpose (test "records why each retried deletion happens").
- **The time-based pass** (`sweep.ts:61-67`) acts only on the **quarantine object of an intent that is closed and past its upload-URL expiry**, plus a half-promoted `evidence/<id>` with **no evidence row** after a crash (`:56-59`).
  - **Promoted evidence (an evidence row) is never deleted by time.** Its only deletion path is account deletion.
  - I read this as failed-upload cleanup, plus staging for completed intents. It's the expiry of an upload *attempt*, not automatic expiry of evidence, so it's **inside** the decision.
  - **One honest edge to document:** a client that PUT the bytes but never called `complete` (a crash or closed tab) has its quarantine object removed after the TTL. The client must re-upload with a new intent (P3-2).
- **`upload_staging`:** deleting the quarantine duplicate after a successful promotion (`evidence.ts:375`, `sweep.ts:65`).
  - **I consider it inside the spirit of the decision.** It's a temporary copy the app made itself, of an object it created, and the user's recording persists as `evidence/<id>`. Nothing user-visible is lost.
  - **But it isn't one of the two purposes Hamza named.** `docs/progress.md:8` records his decision as "failed-upload cleanup and user-requested (account) deletion". Several docs nevertheless present "upload staging" as part of **Hamza's decision** (P2-1).

## 3. The R2 adapter (`apps/api/src/storage/r2.ts:61-68`)
- **Order of checks:** `assertKey`, then `allowDelete` (deletion off refuses before any request), then `^(evidence|quarantine)\/`, then a **single** `DeleteObjectCommand`. That's right: bare local-style keys and any other prefix are refused before a request (test "refuses keys outside evidence/ and quarantine/ before any request").
- **The static test** (`test/storage.test.ts:327-332`) pins the `@aws-sdk/client-s3` import list to the six single-object symbols, and rejects `Lifecycle`, `ListObjects`, `DeleteObjects` and `DeleteBucket` anywhere in `r2.ts`.
  - **Sound for the adapter.** A namespace or second import of a forbidden command would still contain the forbidden name.
  - It covers `r2.ts` only (P3-4).

## 4. Config and docs
- **The config comment** (`config.ts:186-190`) is accurate. Production still requires `ALLOW_DELETE=1` and refuses `RETAIN_NONPROD`, and that's unchanged.
- **Backup retention is left open:** runbook §5 says "still open (not part of the A5 R2 decision)"; the `web-launch.md` §4 row is ⬜; nothing is pruned.
- **The restore note is right** (`production-runbook.md:79`): objects registered only in the newer DB become unknown to the restored DB, and can't be deleted by it. "List them for Hamza; don't delete them by hand."
- **Web-launch decisions are kept separate** from native, device, signing, wallet and payment gates (`web-launch.md` §5). A9, A7, B4 and the Firebase plan check remain open.
- **S7 (multipart):** now ⬜ "policy allows aborting the app's own failed uploads; not built". That's accurate.

## 5. Live test and evidence (`test-live/r2-scoped-delete.live.test.ts`)
- **Guards:** skipped unless `POCKETQA_LIVE_R2_DELETE=1`; the bucket is pinned to `pocketqa-evidence`; the account is pinned by sha256; non-production development settings with the scoped policy on.
- **What it proves:**
  - a full before and after `ListObjectsV2` snapshot of **keys, ETags and sizes** must be **equal** (`:132-134`);
  - the wrapped store's **deleted list must equal the created list** (`:131`);
  - each path is asserted by HEAD: `upload_staging` (`:108`), `failed_upload` (`:116`), `account_deletion` (`:125`);
  - deleting a pre-existing key by name is refused (`:119-120`);
  - the outbox ends empty.
  
  That is sufficient to show only the run's own objects were deleted and everything else is unchanged.
- **Evidence:** `r2-scoped-delete.txt` at `2adea53`. 26 objects before and 26 after; 3 created, the same 3 deleted; EXIT=0. The runner states the account id, key pair and signatures were redacted, and the scan found none.
- **`prod-start-smoke.txt`:** production mode on real Firebase and R2 with `ALLOW_DELETE=1`, on a fresh temp DB, so nothing was registered and nothing was deletable. Health 200; `/config` gives firebase, r2 and both test features off; stopped; no data created.

## 6. The earlier failing test
- **It was the test, not the code.** The "records why each retried deletion happens" assertion originally ordered by `object_key`. Two of the three rows are `quarantine/<random uuid>`, so their order varied between runs.
- The code always queues the same three rows: `evidence/<ev>` for account_deletion, `quarantine/<bad>` for failed_upload and `quarantine/<ok>` for upload_staging.
- It now orders by `purpose`, which is unique per row. My five repeated runs all passed.

## Findings

### P2-1: docs attribute "upload staging" to Hamza's decision, which named only failed-upload cleanup and user-requested deletion
- **Where:**
  - `docs/production/parent-access-actions.md:14` (A5 "DECIDED… failed-upload cleanup, upload staging and user-requested account deletion");
  - `docs/production/web-launch.md:7`;
  - `docs/deploy/production-runbook.md:4`;
  - `docs/production/acceptance-ledger.md:58`, `:144`.
  
  These contradict `docs/progress.md:8` and the decision as relayed.
- **Why it blocks:** the code is fine, and I consider staging inside the decision's spirit. But the decision record must not present the lead's interpretation as Hamza's words.
- **Fix:** label `upload_staging` in those places as "the lead's interpretation, a temporary app-made duplicate of an upload that succeeded; pending Hamza or parent confirmation". Or record the explicit confirmation with its date.
  - If Hamza reads the decision literally, the fix is a one-line config: stop calling `deleteOrQueue(..., 'upload_staging')` and keep the quarantine copy.

### P3-1: production startup drains any pre-existing outbox
- When `ALLOW_DELETE=1` is first turned on over a database that ran in retention-only mode, pre-existing outbox rows (purpose `'unrecorded'`) for registered keys are deleted on the next sweeps.
- The production DB is fresh, so this doesn't apply today. Note it in runbook §5 for any future migration of a retention-mode DB.

### P3-2: document the "uploaded but never completed" case
- `sweep.ts:61-67` removes the quarantine object of an intent that expired before `complete`, even if the bytes arrived.
- That's correct as failed-upload cleanup, but say so in the runbook or web-launch docs, and confirm the app's upload queue re-uploads with a new intent.

### P3-3: local uploads are registered after the file write (`apps/api/src/handlers/evidence.ts:153`)
- That's fail-safe, since unregistered files are never deleted by the app, and local mode only. But the "registered before the write" wording doesn't hold for this path.
- **Fix:** adjust the comment or docs, or register before `pipeline`.

### P3-4: the static import test covers only `r2.ts` (`apps/api/test/storage.test.ts:328`)
- **Fix (optional):** extend the forbidden-symbol check (`DeleteObjects`, `ListObjects`, `Lifecycle`, `DeleteBucket`) to every file in `apps/api/src`, so another module can't add a bulk path unseen.

## Verdict
**The deletion code holds Hamza's scope:**
- the ownership registry is written before R2 writes;
- unregistered keys are never deleted or queued;
- prefix-guarded single-object deletes only;
- no evidence expiry, no lifecycle, no other bucket, no bulk path;
- historical fixtures are undeletable by construction.

The live run proves only the run's own objects were deleted.

**One P2 blocks:** the docs attribute the `upload_staging` interpretation to Hamza's decision. Fix the wording, or record his confirmation.

VERDICT: CHANGES_REQUIRED
