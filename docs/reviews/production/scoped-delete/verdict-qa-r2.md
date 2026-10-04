# pqa-qa verdict: scoped-delete-qa-r2 (targeted re-review)

**Candidate:** code `4fd0071`, evidence `dacce77`, on `feat/web-launch-e2e`.
- Reviewed `git diff bd791af..dacce77`: 13 files.

**Rules held:**
- Read-only, and no other file changed.
- No live or cloud runs.
- No subagents and no advisor.

## What I ran (Node v24.21.0)
- **`apps/api`: `npx vitest run test/storage.test.ts test/evidence.test.ts test/account.test.ts test/backup.test.ts`:** 4 files, 40/40. This includes the widened bulk-API check and the local registration change.
- **Evidence:** all three files name `4fd0071`. A scan found 0 JWT `eyJ…`, 0 `X-Amz-Signature` or `X-Amz-Credential`, 0 `Bearer …`, 0 `AIza` or `AKIA`, and 0 32-hex.
  - **Live deletion:** 26 objects before and 26 after; 3 created, the same 3 deleted; EXIT=0.
  - **Production smoke:** health 200; `/config` gives firebase, r2 and both test features off; EXIT=0.
  - **Verify:** API 382 passed plus 2 skipped, EXIT=0. It ran on the tree just before the commit, which added only the r1 verdict besides these changes.

## r1 findings
| r1 | Change | Status |
|---|---|---|
| **P2-1: staging attributed to Hamza** | The A5 decision text now reads exactly "failed-upload cleanup and user-requested (account) deletion" in `web-launch.md:7`, `production-runbook.md:4`, `parent-access-actions.md:14` and `acceptance-ledger.md` (S5 and notes). `upload_staging` is labelled everywhere as **the lead's interpretation, pending Hamza's or the parent's confirmation**, with the literal-reading alternative stated ("stop the two `upload_staging` calls and keep those copies"). The `sweep.ts` and `config.ts` comments match | **fixed** |
| **P3-1: outbox drain on enabling deletion** | Runbook §5: retention-only databases may hold `unrecorded` outbox rows for their own keys, which the first sweeps delete; review `SELECT object_key, purpose FROM storage_deletions` before switching. The production DB starts fresh | **fixed** |
| **P3-2: uploaded but never completed** | Runbook §5 and the `sweep.ts` purpose comment: it is failed-upload cleanup, and the app retries with a new intent. **Verified in code:** a failed segment stays queued (`segments.ts:50-63` retries `failed`). Each attempt calls `createUploadIntent` (`client.ts:137`), and the API reuses only a still-valid pending intent (`evidence.ts:243`), so an expired one gets a fresh intent | **fixed** |
| **P3-3: local registration order** | `registerObject` now runs before `pipeline` writes the file (`evidence.ts:124-125`). An aborted upload leaves only a harmless registry row for a key with no object; deleting a missing key is a no-op, and the registry is never pruned by design | **fixed** |
| **P3-4: static check scope** | `test/storage.test.ts` now walks every `.ts` file in `apps/api/src` and forbids `Lifecycle`, `ListObjects`, `DeleteObjects` and `DeleteBucket` | **fixed** |

## Open (non-blocking)
- **`upload_staging` awaits Hamza's or the parent's confirmation,** as the docs now say. If he declines, it's a two-call change (`evidence.ts:375`, `sweep.ts:65`) that keeps those copies.
- **Backup retention** and re-applying deletions after a restore remain open, and are kept separate from A5.

## Verdict
The deletion code holds Hamza's scope, and the decision record now separates his decision from the lead's interpretation. Every r1 finding is fixed, and the regenerated evidence at `4fd0071` is token-free and shows only the run's own objects deleted.

VERDICT: APPROVE
