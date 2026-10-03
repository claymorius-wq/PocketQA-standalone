# Freeze candidate: cloud backend increment 3, private evidence storage (R2)

**Worktree:** `/Users/hamzadiaz/Projects/pocket-qa/.worktrees/cloud-auth-wallet`. **Branch:** `feat/cloud-auth-wallet`.
**Base:** commits `f655d8f` (identity) and `1d8d9dd` (wallet login); this increment is staged on top.
**Scope:** ADR 0005 §3, plan Phase 2. No bucket or account was created; R2 is exercised through a local fake S3.

## Changes
- **Storage interface** `apps/api/src/storage/types.ts` (`head`, `readRange`, `copy`, `delete`, `presignPut`, and `assertKey`, which accepts server-generated keys only), with two adapters:
  - `local.ts`: today's media directory; existing plain-id keys keep working;
  - `r2.ts`: AWS S3 SDK against R2, path-style, region `auto`, credentials from config only; the presigned PUT signs `content-type` and `content-length`.
- **Config:**
  - `POCKETQA_STORAGE=local|r2`;
  - R2 account id (32 hex), bucket and access key pair are required for r2;
  - `POCKETQA_R2_ENDPOINT` override is loopback only;
  - r2 is refused with `POCKETQA_SHARED_DEMO=1`.
- **Contracts:** `CreateUploadIntentBody` (evidence metadata plus `mimeType` and exact `sizeBytes`), `UploadIntent`, `UPLOAD_INTENT_TTL_SECONDS` (15 min), and routes `POST /participations/:id/evidence/upload-intents` and `POST /evidence/upload-intents/:id/complete` (tester-owner).
- **Migration 3:** `upload_intents` (one open intent per participation segment; reserved bytes; `quarantine_swept`), and `storage_deletions` as an outbox.
- **Handlers** (`evidence.ts`):
  - **Intent:**
    - ownership comes first, so non-owners get 404;
    - the same state, task and kind-vs-type rules as multipart;
    - quota counts evidence **plus open intents' declared bytes**;
    - idempotent per segment (fresh URL, same quarantine key);
    - presigned for at most 10 minutes, within the intent's life.
  - **Complete:**
    - owner only;
    - a pending, unexpired intent is required;
    - HEAD must find the object (otherwise a retryable 409);
    - an atomic claim (`pending` to `completing`) refuses concurrent completions with 409;
    - the real size must equal the declared size and stay within limits;
    - the sniffed content type must equal the declared type;
    - copy to the immutable `evidence/<id>`, then a transaction re-checks state, duplicates and quota before inserting the evidence;
    - quarantine is deleted.

    Failures follow one rule: validation rejects and deletes; transient storage errors return the intent to `pending` (retryable); a transaction failure deletes the copy.
  - **Multipart:** refused in r2 mode.
  - **Media playback:** reads through the store, keeping ranges, the use-time permission re-check, `no-store` and `nosniff`.
- **Submission** is blocked while intents are open (`participations.ts`).
- **Account deletion:** objects go through `deleteOrQueue`, and open intents are closed with their quarantine removed.
- **`storage/sweep.ts`**, run at server start and every 60 s:
  - expires stale intents;
  - removes quarantine objects of closed intents once their URLs have expired, which catches re-PUTs after completion;
  - cleans up crash-abandoned completions;
  - retries the outbox with exponential backoff.
- **App** (`apps/mobile/src/api/client.ts`):
  - `getClientConfig()` is cached;
  - in r2 mode `uploadEvidence` creates an intent, PUTs with exactly the signed headers and **no bearer** (retried up to 3 times), then completes. A failed PUT is never completed.
  - The type comes from the blob, falling back to the file extension.

## Evidence
- **Red first:** `test/storage.test.ts` and `__tests__/direct-upload.test.ts` failed (missing modules) before the implementation.
- **API storage tests** (11), all with the real R2 adapter against `test/fakeS3.ts`:
  - full flow with ranges;
  - multipart off in r2 and intents off in local;
  - idempotency and cross-account 404;
  - spoofed type and size mismatch rejected, with objects deleted;
  - "not arrived" is retryable;
  - reserved bytes count toward quota;
  - submission blocked while uploads are open;
  - expiry plus sweep (including a re-PUT after completion);
  - concurrent completion (one evidence, the intent stays `completed`, losers get 409);
  - the deletion outbox survives a provider failure;
  - config exposes no storage credentials.
- **Config tests** (3).
- **App tests** (4): local multipart; r2 intent, PUT and complete with no bearer to storage; retry and no complete after a failed PUT; type from the extension.
- **Ownership matrix:** extended with both new routes.
- **Mutations**, each caught:
  - S1: no size check;
  - S2: type not matched;
  - S3: quota ignores reservations;
  - S4: no atomic claim. It first survived because of the database backstop; the test was strengthened to assert the intent status and 409s.
  - S5: submit with pending uploads;
  - S6: no promotion to a final key;
  - S7: no outbox;
  - S8: closed quarantine not swept.
- **`pnpm verify`:** see `inc3-pnpm-verify.txt`.

## Gates and limits (documented)
- **Real R2:** a verified Optijara account, a private bucket, a bucket-scoped token, exact-origin CORS for PUT, and lifecycle rules. The fake S3 doesn't verify signatures or the signed content-length; real R2 does.
- **Uploads:** single PUT only, up to 100 MB per item (contract limit). Multipart/resumable uploads for larger recordings, and native background upload, are not built: a retry re-PUTs from the start.
- **Sweep and outbox:** they run in the API process. Multi-instance hosting needs a single runner or a lock (hosting gate).

## After r1 APPROVE: P3 fixes (`inc3-verdict-qa-r1.md`)
- **P3 #1, swap between validation and promotion.**
  - `head()` now returns an ETag, and `readRange`/`copy` accept `ifMatch` (R2: `IfMatch` / `CopySourceIfMatch`; local: a size, mtime and inode tag).
  - A precondition failure is `StorageChanged`, and completion returns a retryable 409 with the intent back to `pending`.
  - The fake S3 now has md5 ETags and returns 412 on mismatch.
  - Test: bytes swapped right after HEAD give a 409 with no evidence and no final object; completing again validates and records the bytes actually stored. It ran red, then green. Mutation S9 (no pinning) is caught.
- **P3 #2:** status resets during completion are conditional (`AND status = 'completing'`), so they never reopen an intent closed by deletion or the sweep.
- **P3 #3–#5:** documented in ADR 0005 §3 limits (16-byte sniff, real-R2 checks to record at the gate, single PUT, single sweep runner).

## After r2 APPROVE (both r2 P3s applied)
- An empty ETag from HEAD gives a retryable 409 before the claim; completion never proceeds unpinned. A test was added.
- The final `completed` update is conditional on `completing`, and the transaction fails (deleting the copy) if the intent was closed meanwhile.
- `pnpm verify` EXIT=0 (API 333 plus 2 emulator-only; mobile 678).
