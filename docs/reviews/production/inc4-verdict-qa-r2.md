# pqa-qa verdict: production increment 4 (operations), r2 (security and product)

**Candidate:** the `git diff --cached` set in `.worktrees/production-readiness` (28 files, base `16378f4`), covering the "r1 follow-ups" section of `inc4-candidate.md`.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.

## What I ran
- **`pnpm verify` with Node v24.21.0:** EXIT=0.
  - `check:secrets` scanned 620 files with no findings.
  - Script tests: 45.
  - Test counts: contracts 17, domain 170, API 369 passed plus 2 skipped, mobile 729.
  
  These match the candidate.
- **The `run-api.sh` env parser loop, run on a scratch file** with the runbook's inline-comment style (deleted afterwards). The values came out as `[pocketqa-evidence                   # pinned in code]` and `[1                             # ONLY after]`, which is finding P3-1.
- **Inspected `native-production-build/launch.png`:** "Can't reach Pocket QA", the server isn't answering, sign-in isn't available, and "Try again". There is no local sign-in form.
- **Not rerun by me:** Playwright (the lead reports 12/12), the Firebase E2E (the lead reports 4/4; I ran it 4/4 in inc2), and the emulator APK.

## r1 follow-ups
| r1 | Status |
|---|---|
| P3-1: backup retention and restore undoing deletions | addressed procedurally: runbook §5 has a re-deletion step and a retention note, and A5 now covers both |
| P3-2: backup ran migrations | **fixed.** `db:backup` opens a read-only `Database(file, { readonly, fileMustExist })`. Test: "backup never migrates the live database" |
| P3-3: port-only restore check | **fixed.** `api.pid` (0600) is written before `listen` and removed on clean stop. `apiRunning` checks with `kill(pid, 0)` (EPERM counts as alive) and ignores a stale pid. The restore refuses on port **or** pid. The real-process test uses a different port |
| P3-4: env file sourced as shell | **fixed.** Literal `KEY=VALUE` parsing that refuses junk lines; a test shows `$(…)` and backticks never run. A new doc mismatch follows (P3-1 below) |
| P3-5: symlinked backup dir | **fixed.** The check uses the realpath of the nearest existing ancestor, with a symlink-into-repo test |

## The new app change: production "Can't reach Pocket QA"
- In `SessionProvider`, `!cfg && PRODUCTION_BUILD` sets `unreachable` and returns before any auth setup. The app no longer falls back to local mode, which would have shown a password form a production API refuses.
- `retryConnection` re-runs the config effect; the previous Firebase listener is cleaned up through the effect's cleanup.
- A persisted keystore session isn't cleared while unreachable, so it resumes after a successful retry.
- Development builds are unchanged.
- This is correct and fails closed.

## Findings (all P3, non-blocking)

### P3-1: the runbook's example env file doesn't work with the new literal parser
- **Where:** `docs/deploy/production-runbook.md` §2. Most lines carry trailing `# …` comments, and `run-api.sh` now keeps them as part of the value.
- **Scenario (executed on the parser):**
  - `POCKETQA_R2_BUCKET` becomes `pocketqa-evidence   # pinned…`, so startup refuses the bucket.
  - `POCKETQA_R2_ALLOW_DELETE` becomes `1   # ONLY after…`, which is not `'1'`.
  - `GOOGLE_APPLICATION_CREDENTIALS` and `POCKETQA_PUBLIC_ORIGIN` get trailing junk.
- **Effect:** every case fails closed, with no security impact. But the documented procedure can't start as written, and the script test's placeholder file has no inline comments, so this wasn't caught.
- **Fix:** move the comments onto their own lines in the runbook example, or strip an unquoted ` #…` suffix in the parser. Add the runbook example (with placeholders) to the `run-api.sh` test so the doc and the parser can't drift apart.

### P3-2: the "unreachable" state has no unit test
- The mobile count didn't change (729). The only evidence is the emulator screenshot.
- **Fix:** add a `SessionProvider` test showing that a production build with a failing `/config` gives `unreachable` with no sign-in form, a development build doesn't, and retry recovers. Optionally use a refresh icon instead of `LogIn` for "Try again".

### P3-3 (optional): the env parser accepts any upper-case key
- `NODE_OPTIONS=--require …`, `PATH` or `DYLD_*` in the env file would change how Node starts.
- The file is owner-only, so the trust is the same as before. Still, an allowlist (`POCKETQA_*`, `GOOGLE_APPLICATION_CREDENTIALS`) would make the file data-only.

## Gates still not run (kept open)
- **Installing launchd and running the drill on the production host:** waiting on access action A7.
- **Everything from earlier increments:** A1–A6 and A8, real wallets, and a physical device.

VERDICT: APPROVE
