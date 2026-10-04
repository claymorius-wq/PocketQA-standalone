# pqa-qa verdict: safety candidate, r1 (security and product)

**Scope:**
- Commit `5f2680b`: the post-approval changes made for the `live-verdict-qa-r1` P3s.
- The staged, uncommitted safety fixes (`git diff --cached`), described in `safety-candidate.md`.
- The parent's additional release criteria (2026-10-04):
  - With R2 deletion off, account deletion must not report a success that implies media was erased. The behaviour must fail closed, with an exact gate documented. Real-user cloud mode stays off until Hamza sets a deletion policy.
  - Existing unrelated buckets must never be writable targets.

**Method:**
- I read the code and docs, and ran read-only `git show` / `git diff --cached`, `grep`, and `node scripts/check-secrets.mjs` (545 committable files scanned, no findings).
- I ran no live provider test, made no R2 or Firebase call, and made no commit.
- I didn't read `.cloud-local/`, `.env*` (apart from the staged `.env.example` diff), `.preview*` or `preview-data`.

## Verified
- **No R2 delete is possible with `POCKETQA_R2_ALLOW_DELETE` unset.**
  - In `apps/api/src`, `DeleteObjectCommand` is sent from exactly one place: `storage/r2.ts:64`.
  - The new guard at `r2.ts:63` throws before the client is used.
  - `config.ts:149` sets `allowDelete` only when the value is exactly `'1'`.
  - Every caller goes through `deleteOrQueue` or the outbox retry in `storage/sweep.ts`:
    - completion: `evidence.ts:321`, `:366-370`;
    - account deletion: `account.ts:294-295`;
    - the stuck and closed sweeps, and the retry: `sweep.ts:34,41,47`.
  - No other S3 client exists. The local store is unaffected by design.
- **Outbox behaviour when off:**
  - Each refused delete becomes one row (`ON CONFLICT DO NOTHING`).
  - Retries make no network call, and back off to 1 h.
  - Each sweep handles at most 500 rows.
  - Growth is bounded by the number of uploads, which is acceptable.
  - Note: turning the flag on later drains the whole backlog at once, which the approval should account for (P3-1).
- **Tests:**
  - `identity-config.test.ts` checks that deletion is off by default and on only with `1`.
  - `storage.test.ts` "R2 deletion guard" checks that after completion and a sweep past expiry, the quarantine and evidence objects both remain and the outbox is non-empty.
  - `helpers.ts` keeps `allowDelete: true` against the fake S3 only, so the designed deletion paths stay covered.
  - `safety-pnpm-verify.txt`: EXIT=0; API 339 passed and 2 skipped; mobile 709.
- **Docs:**
  - No lifecycle or expiry advice remains. The only mentions are the withdrawals and prohibitions: `cloud-backend.md:39,78`, ADR 0005:69, `pr-body.md:53`, `inc3-candidate.md:79`, `live-candidate.md:45`.
  - No doc claims Firebase Auth is enabled. Every status line says `CONFIGURATION_NOT_FOUND`: `cloud-backend.md:24`, `pr-body.md:44,56`, `live-candidate.md:36`.
  - No billing change is advised anywhere.
- **Personal token withdrawn:**
  - The live Firebase test's doc comment and `cloud-backend.md` user action 2 require the dedicated `pocketqa-api` service account and forbid personal login tokens.
  - I can't independently confirm the scratchpad deletion, since it is outside the worktree. That evidence is the lead's.
- **Service account is minimal and correct:**
  - `roles/firebaseauth.admin` on the project only, with no Owner or Editor.
  - `iam.serviceAccountTokenCreator` on itself only, at resource level, and only for wallet custom tokens.
  - `iam` and `iamcredentials` APIs enabled; no billing.
- **The `5f2680b` P3 fixes are applied:**
  - `test-live/**` is excluded from the default vitest config; the live suites have their own `vitest.live.config.ts` and `test:live` script.
  - The account is pinned by SHA-256 (`r2.live.test.ts:58`).
  - The upload URL assertion checks only the path (`:142`).
  - The deploy-doc corrections are made.
- **No secrets in staged files:** `check:secrets` is clean, and the staged doc diffs contain no key, token or 32-hex shapes.

## Findings

### P2-1: account deletion reports success while recordings are retained (parent criterion 1)
- **Where:**
  - `apps/api/src/handlers/account.ts:294-305`: `deleteMe` returns `{ ok: true }` unconditionally.
  - `apps/mobile/src/screens/SettingsScreen.tsx:105`: the copy says "Deletion removes your media".
- **Scenario:**
  1. The API runs with `POCKETQA_STORAGE=r2` and the deletion flag unset (now the default).
  2. A tester deletes their account. The database rows go, but every `evidence/<id>` and quarantine object is refused, queued and kept indefinitely.
  3. The API still answers `ok`, and the app has just told the tester their media is removed.
- **Effect:** this is a misleading erasure claim. Nothing in config stops r2 mode from being enabled for real users in this state.
- **Fix (fail closed), choosing one gate and testing it:**
  - (a) **Config gate (recommended).** `loadConfig` refuses `POCKETQA_STORAGE=r2` while deletion is off, unless an explicit non-production acknowledgement is set, for example `POCKETQA_R2_RETAIN_NONPROD=1`, meaning synthetic users only.
    - Real-user cloud mode then can't start until Hamza sets `POCKETQA_R2_ALLOW_DELETE=1` under an approved policy.
    - Test: r2 without the flag or the acknowledgement throws a `ConfigError`.
  - (b) **API gate**, in addition to (a) or instead of it. In r2 mode with deletion off, `deleteMe` refuses before changing anything (for example `409 MEDIA_DELETION_UNAVAILABLE`). The app shows a truthful message: account deletion is unavailable while stored recordings can't be erased.
    - Alternatively, `deleteMe` returns `mediaRetained: n` and the app says plainly that recordings are kept pending manual deletion.
    - Tests: the API response, and the app copy for that state.
- **Docs:** write the exact gate into `cloud-backend.md` user action 5 and the feature-flag table: "real-user cloud mode is OFF until Hamza approves a deletion policy".

### P2-2: the app's bucket isn't pinned, so an unrelated bucket can be a write target (parent criterion 2)
- **Where:** `apps/api/src/config.ts:135-139`. Any well-formed `POCKETQA_R2_BUCKET` is accepted. The bucket pin and the account hash exist only in the live test (`r2.live.test.ts:57-58`), not in the app.
- **Scenario:**
  1. The API is started with the account-level credentials used for the live run. They can reach every bucket in the account, including other projects' production buckets.
  2. A mistyped or copied `POCKETQA_R2_BUCKET` makes the presigned PUT and copy go to an unrelated, existing bucket.
- **Effect:** "Use a bucket-scoped token" is documented, but nothing enforces it.
- **Fix:**
  - Pin the bucket in config to an allowlist: `pocketqa-evidence`, plus any staging bucket named explicitly in the ADR. Anything else gives a `ConfigError`.
  - Optionally also pin the account by hash, as the live test does.
  - Test that an unlisted bucket is refused.
  - In `cloud-backend.md`, state that account-level or other-project R2 credentials must never be used for the app, and that only the bucket-scoped token (user action 3) is acceptable.

### P3-1: enabling deletion later drains the backlog at once
- Setting `POCKETQA_R2_ALLOW_DELETE=1` deletes every queued key on the next sweeps. That includes quarantine copies that are being kept as evidence of a dispute.
- Fix: document in user action 5 that enabling deletion drains the outbox. Optionally require a reviewed export of the outbox (a key list) before enabling.

### P3-2: the token-creator role is needed only without a JSON key
- With a service-account JSON key, the Admin SDK signs custom tokens locally. `serviceAccountTokenCreator` and `iamcredentials` are needed only with workload identity or ADC without a key.
- Fix: one clarifying line in user action 2, so a key-based host doesn't get a role it won't use.

## Verdict
The staged deletion guard itself is correct: no R2 delete can happen while the flag is unset. It doesn't yet meet the parent's two added release criteria, since nothing gates against a misleading account-deletion success and the app's bucket isn't pinned.

VERDICT: CHANGES_REQUIRED
