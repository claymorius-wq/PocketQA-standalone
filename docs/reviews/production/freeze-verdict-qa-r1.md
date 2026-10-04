# pqa-qa verdict: whole-branch freeze review, r1 (security and product)

**Scope:**
- The branch range `9461db5..HEAD` (`a350118`, `90a5ddd`, `16378f4`, `4028884`): 125 files.
- The staged freeze set:
  - `admin:grant` refuses a schema mismatch instead of migrating;
  - ledger S7 and D5;
  - `docs/verification.md`, `docs/progress.md` and `pr-body.md`.
- Reconciling `docs/reviews/release/qa-ledger.md` with `docs/production/acceptance-ledger.md`.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.

## What I ran on the freeze tree (Node v24.21.0)
- **`pnpm verify`:** **EXIT=0**.
  - `check:secrets` scanned 624 files with no findings.
  - Script tests: 47.
  - Test counts: contracts 17, domain 170, API 369 passed plus 2 skipped, mobile 731.
  
  These match the brief.
- **Playwright (`apps/mobile`):** **12/12**, PW_EXIT=0. I restored the screenshots with `git restore docs/reviews/gate-a docs/reviews/remaining-scope`, and the worktree is clean apart from the staged set.
- **`pnpm test:e2e:firebase`** (local Auth emulator, `demo-pocketqa`): **4/4**.
- **`PROD_API_URL=/api bash scripts/production/build-web.sh`:** EXIT=0, and the secret check found 0 values in 29 files.
- **`git diff 9461db5 HEAD --stat -- scripts/preview`:** empty. The demo preview's scripts are untouched across the whole branch (A10 and D5).
- **Branch grep for added R2 deletion or bucket-config paths** (`DeleteObject`, `AbortMultipart`, `deleteOrQueue`, `.delete(`, lifecycle, `PutBucket*`) in `apps`, `packages` and `scripts`: the only hit is a jest mock of `deleteItemAsync` (the keystore). No new R2 delete path exists.

## Post-approval changes inside the commits (checked here)
`16378f4` and `4028884` include P3 follow-ups that were applied after my increment verdicts. I checked each one on the freeze tree:
- **The sign-in-specific `-2`/`-4` wallet text** ("couldn't sign the sign-in message. You are not signed in.") is in `errors.ts:19`.
- **The MWA statement adds "Only sign this in the Pocket QA Android app, never on a website."** (`walletLogin.ts:57`). The re-run Maestro flow (`inc3-native/2026-10-04_122129`) asserts that text on the mock wallet.
- **The env parser allowlists `POCKETQA_*` and `GOOGLE_APPLICATION_CREDENTIALS`.** The runbook env block has comments on their own lines only. A drift test parses the runbook block (`production-scripts.test.mjs:133`).
- **There is now a unit test for the unreachable state** (`__tests__/session-unreachable.test.tsx`).
- **The staged `admin:grant` change** opens the DB without `openDb`, so it never migrates. It refuses when `schema_migrations` doesn't match `MIGRATION_COUNT`, with a test. This closes the same class of problem as inc4 P3-2.

## Ledger reconciliation (my A1–A10 against the lead's rows)
| Mine | Lead rows | Agreement |
|---|---|---|
| A1: real auth | I1, I4, I7 (code, verified by me); I2, I3, I5, I6 ⛔ A1/A2 | ✔ The live gates stay open |
| A2: private R2 | S1 ✅ (PR #2 live); S2, S3, S4 ⛔ A3/A4 | ✔ |
| A3: no demo or test top-ups | D1–D4 | ✔ Verified (inc1 r2 probe, tests, web bundle) |
| A4: wallet UX | W1–W3 (Playwright, plus MWA on an emulator); W4 ⛔ A8; W5 ⬜; W6 ⛔ A6 | ✔ |
| A5: native persistence | I8 (emulator only) | ✔ Physical device open (N2) |
| A6: account lifecycle | I4, I7; deletion depends on S5 | ✔ The self-deletion audit row is a recorded follow-up |
| A7: restart and backup | O1, O2, O4 (local real process; my own drill); host ⛔ A7 | ✔ |
| A8: no payment or AI claims | B2 prohibited, B3 ✅, D3 | ✔ |
| A9: no R2 deletion or lifecycle; other buckets untouched | S5 open, S7 ⛔ A5 (multipart abort deletes parts, correctly treated as deletion); bucket pin | ✔ No new delete path on the branch |
| A10: demo untouched | D5 ✅ | ✔ Empty `scripts/preview` diff |

No contradictions. The lead's 🔧 rows mean "code done, awaiting review or provider evidence". Every code part of them now has an independent APPROVE from me.

## PR body check (`pr-body.md`)
- **It states plainly:** not production-ready; production can't start until A5 (and A9); the demo is untouched; "Do not merge until the parent verifies".
- **The evidence it lists matches what I ran or inspected:** verify, Playwright 12/12, Firebase E2E 4/4, the web export, and the native emulator-only runs.
- **The open gates and residual risks match the ledger:**
  - admin MFA;
  - the unverifiable `pocketqa.local` MWA identity;
  - iOS keystore size;
  - backup retention and re-deletion after a restore under A5.
- **It claims nothing beyond the evidence.** Native runs are labelled "EMULATOR ONLY", and the probes are read-only.

## Findings (all P3, non-blocking)

### P3-1: PR body wording
- **The review column says "r1 APPROVE" / "r2 APPROVE".** Two of those commits contain P3 follow-ups made after those verdicts. Add "P3 follow-ups applied after review; covered by `freeze-verdict-qa-r1`", as the commit messages already say.
- **"API 369+"** should read "API 369 + 2 skipped".

### P3-2: process disclosure to carry into the PR
- `docs/progress.md` discloses that the lead used the in-session advisor tool and briefly started one Explore subagent. Both are outside the team rules (no advisor, no subagents).
- The disclosure is honest and recorded.
- Every committed change on this branch was also reviewed independently by me, and re-run here.
- **Recommend:** the PR body points at that disclosure, so the parent and Hamza see it at merge time, not only in `progress.md`.

### P3-3 (housekeeping): close out the 🔧 statuses
- Once the parent accepts this freeze, move the ledger's code-only 🔧 rows to ✅ where no provider or hardware part remains: I1, I4, I7, D1–D4, O1, O2, O6–O9. Keep 🔧 or ⛔ for I8, W3, O4, O5 and N1.

## Gates still open (honest, unchanged)
- **Real provider:** I2, I3, I5, I6, S2, S3, S4.
- **Hardware and store:** N2, A6, I9, W5, W6, S6.
- **Business:** A5 (including backup retention and re-deletion), A9/B1, A8/W4, B4.
- **Blocked by the no-deletion rule:** S7.
- **The production host install and its drill:** waiting on access action A7.

VERDICT: APPROVE
