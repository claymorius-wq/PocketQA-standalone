# Full end-to-end acceptance (2026-10-06)

Scope: `docs/plans/end-to-end-product-acceptance-checklist.md` (main checkout), requested by Hamza. Lead: pocketqa-lead (wX:p1). Independent challenge/review: pqa-qa (wX:p2).

## Frozen baseline (read 2026-10-06T18:31:57Z)
- Live deployment `dpl_GAmobrPxJNns8u1sHaSU2GrXVhJz` (alias https://pocketqa.vercel.app). It serves `entry-0e22ecce65b4080a0dad7d009c5007c3.js`, the bundle pqa-qa rebuilt byte-identically from `7beaad5` (`feat/firebase-vercel`).
- `/api/config`: authMode firebase, storage r2, walletLogin **false**, testCredits true, devnetTransfers **false**, settlement **simulated**, googleSignIn true.
- Pending and not yet deployed: the branded Google button (`532a435`, under QA review). Auth-UI rows are re-run after it deploys; every other row binds to the frozen deployment above.

## Rules for every row
- Status: `PASS | FAIL | BLOCKED | NOT OFFERED | NOT RUN`. No row is PASS on aggregate test counts alone.
- Environment, one of:
  - `hosted-simulated`: live pocketqa.vercel.app, settlement simulated, test credits (bookkeeping, not money);
  - `emulator`: Firebase emulators + local API;
  - `local-api`: the SQLite API on loopback;
  - `unit`: jest/vitest;
  - `physical-android`: a real Seeker;
  - `devnet`: Solana devnet, valueless;
  - `static`: source/copy inspection.
- Synthetic data only: email `pqa-e2e-<role>-<n>@example.test`-style or the existing labelled synthetic accounts, display names starting "QA synthetic". Never touch Hamza's account, his migrated data, or the Seeker submission/recording. No deletion of existing users or media, no admin grants on production, no billing, no mainnet, no private keys printed or committed.
- Each agent writes ONLY its own part file, `docs/reviews/full-e2e/parts/<agent>.json`, an array of rows:
  ```json
  {"id":"T-07","area":"tester","title":"…","status":"PASS","environment":"hosted-simulated",
   "deployment":"dpl_GAmo…","sha":"7beaad5","steps":"…","fixtures":{"builder":"uid…","study":"…"},
   "observed":"…exact values…","evidence":["docs/reviews/full-e2e/evidence/<agent>/…"],"notes":"…"}
  ```
  Evidence (screenshots, command output, JSON readbacks) goes under `docs/reviews/full-e2e/evidence/<agent>/`. Redact tokens and keys.
- Bugs: one row with status FAIL, plus `docs/reviews/full-e2e/bugs/<id>.md` (repro, expected, observed, evidence). Never edit app source in the shared `firebase-vercel` worktree. A fix goes on its own worktree branch (`git worktree add .worktrees/e2e-fix-<id> -b fix/e2e-<id> feat/firebase-vercel`), test first, then report the SHA to the lead for review and deploy.
