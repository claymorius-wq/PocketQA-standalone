# pqa-qa verdict: scoped-delete-qa-r3 (the literal A5 scope delta)

**Candidate:** code `ddb8b0d`, evidence `6f19816` (HEAD, docs only), on `feat/web-launch-e2e`.
- Reviewed `git diff bc27194..HEAD`: 17 files.
- This replaces my earlier "PENDING" r3 note, which `6f19816` had committed.

**Context:** the parent requires the **literal** A5 scope: delete only for failed-upload cleanup and user-requested (account) deletion. My r2 approval of `4fd0071`, which still deleted staging copies automatically, is **superseded**. The docs now say so: ledger S5, the handoff PR body, `progress.md` and `web-launch.md`.

**Rules held:**
- Read-only: only this file written.
- No live or cloud runs.
- No subagents and no advisor.

## What I ran (Node v24.21.0, `apps/api`)
- **`npx vitest run test/storage.test.ts`, three times:** 24/24 each time.
- **`npx vitest run test/storage.test.ts test/evidence.test.ts test/account.test.ts test/backup.test.ts`:** 4 files, 43/43.
- **`grep -rn upload_staging apps/api/src`:** 0 hits.
- **Evidence:** all three files name `ddb8b0d`. A scan found 0 JWT, 0 `X-Amz-Signature` or `X-Amz-Credential`, 0 bearer, 0 `AIza` or `AKIA`, 0 32-hex.
  - **Live:** 26 objects before and 26 after, identical; 3 created, the same 3 deleted; EXIT=0.
  - **Production smoke:** health 200; firebase and r2; test features off; EXIT=0.
  - **Verify:** API 385 passed plus 2 skipped; mobile 1021; EXIT=0 on the exact tree.

## Delta checked against the literal scope
1. **Staging deletion is removed.**
   - **Completion** no longer deletes the quarantine copy (`evidence.ts:376-377`, comment only).
   - **The sweep's closed pass** (`sweep.ts:67-74`) deletes a quarantine object as `failed_upload` only for `rejected` or `expired` intents.
     - For a `completed` intent it deletes **only if that intent's evidence row no longer exists**, as `account_deletion`.
     - Evidence rows are deleted **only** by account deletion (`account.ts:277` is the sole `DELETE FROM evidence` in `apps/api/src`).
     - `evidence_id` is always set before `completed`: it's claimed at `completing` (`evidence.ts:314`), and `completed` is set at `:366`. So a NULL `evidence_id` can't trigger this branch.
     - **So no successful upload's copy is ever removed except after its owner's user-requested account deletion.** This is how a re-PUT made through the still-valid URL after that deletion gets cleaned up.
     - **I consider this addition inside the literal scope:** it completes a user-requested deletion and nothing else.
   - **The type** is `DeletionPurpose = 'failed_upload' | 'account_deletion'`, and a test forbids `upload_staging` anywhere in `apps/api/src`.
2. **Account deletion** (`account.ts:274-276`) now also deletes `upload_intents.object_key` for each deleted evidence row (the kept quarantine copy), plus pending and completing quarantine objects as before. So no copy of a user's recording survives a user-requested deletion.
   - Test: "account deletion removes the recording, its kept quarantine copy and open uploads; a late re-PUT is swept". Only the planted foreign fixtures remain, byte-identical.
3. **Failed promotion** is unchanged: the final key plus quarantine, both `failed_upload`.
4. **Retention:** "a successful upload keeps its quarantine copy through every sweep; failed ones are removed (literal A5 scope)". Three sweeps past the TTL leave `evidence/<id>` plus the kept `quarantine/<id>`, with the rejected and the never-completed uploads removed and the outbox empty.
   - The outbox-purposes test now shows the kept copy queued only as `account_deletion`.
5. **No lifecycle or bulk paths:** the static check over every `apps/api/src` file (`Lifecycle`, `ListObjects`, `DeleteObjects`, `DeleteBucket`) and the six-symbol S3 import pin are unchanged and passing. The ownership registry and the prefix guard are unchanged.
6. **The live test** asserts that after completion the quarantine copy is **kept** (size equals MP4) **and nothing has been deleted** (`deleted` is `[]`), and that account deletion then removes both copies. The before and after bucket snapshots are identical.
7. **The docs match the code:**
   - the A5 text is literal everywhere;
   - "a successful upload's quarantine copy is **kept** … deleted with its owner's account";
   - S5 is "🔧 … literal-scope implementation awaiting pqa-qa (earlier r2 APPROVE of `4fd0071` superseded)";
   - backup retention is still open.

## Findings (no P0, P1 or P2)

### P3-1 (for the parent's awareness; existing behaviour, not introduced here)
- Account deletion removes evidence the user recorded **and evidence inside studies the user owns** (`account.ts:265-270`). So a **builder** who deletes their account also deletes testers' recordings, and now their kept copies, in that builder's studies.
- That follows the original account-deletion design (export and delete, ADR 0002) and is triggered by a user's request. Still, under the literal reading the parent may want to confirm that "user-requested account deletion" covers study data owned by the deleting builder.
- **Not blocking.** Record the confirmation, or the decision to change it, in the A5 entry.

## Verdict
**`ddb8b0d` implements the literal A5 scope:**
- deletion only for failed-upload cleanup and user-requested account deletion;
- successful uploads' copies retained until then;
- no automatic expiry, no lifecycle, no bulk path, no other bucket;
- only registered (app-created) objects.

The tests, the live proof and the token-free evidence support it. This approval covers exactly code `ddb8b0d` with evidence `6f19816`. Any later change needs a new review.

VERDICT: APPROVE
