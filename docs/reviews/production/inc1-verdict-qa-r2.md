# pqa-qa verdict: production increment 1, r2 (security and product)

**Candidate:** the `git diff --cached` set in `.worktrees/production-readiness` (39 files, base `9461db5`). The changes are listed in the "r1 fixes" section of `inc1-candidate.md`.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.

`docs/production/wallet-login-design.md` was read for awareness only. It is **not** part of this verdict, and I'll review it with increment 3.

## What I ran
- **`pnpm verify` with Node v24.21.0:** EXIT=0.
  - `check:secrets` scanned 564 files with no findings.
  - Script tests: 41/41.
  - Test counts: contracts 17, domain 170, API 355 passed plus 2 skipped, mobile 714.
  
  These match the candidate's claims.
- **`scripts/check-node.mjs` with Node 25.4:** exit 1, with the "outside engines.node" message (P3-4 is confirmed).
- **A `loadConfig` probe** (a temporary tsx script, removed afterwards):
  - **P2-1 is fixed.** With `POCKETQA_ENV` unset, startup is **refused** for:
    - real Firebase plus real R2 plus `RETAIN_NONPROD`;
    - real Firebase only;
    - real R2 only.
  - Startup still loads, as intended, for:
    - a loopback R2 test server;
    - a `demo-` emulator;
    - all-local;
    - an explicit `POCKETQA_ENV=development` with real R2. That is a deliberate operator choice, and the live tests use it.
  - **P3-1 is fixed.** As the production origin, these are all refused:
    - `https://localhost`, `https://localhost.`, `https://127.1` and `https://2130706433`;
    - `https://0.0.0.0` and `https://[::ffff:127.0.0.1]`;
    - `https://192.168.1.5` and `https://[fd00::1]`.
    
    `https://pocketqa.optijara.ai` loads, with production on and both test features off.
- **`build-web.sh` refusals:**
  - `PROD_WEB_DIR` of `../x`, `.` or `apps/mobile` exits 1 before any `rm -rf` (P3-3).
  - `PROD_API_URL` of `https://127.1`, `https://[::1]` or `https://192.168.0.2` is refused with "must be a public host" (P3-2).
- **The good build, `PROD_API_URL=/api`:** EXIT=0. The secret check found 0 values in 29 files, and the worktree is clean afterwards.
- **Source checks:**
  - `isPublicHost` in contracts and its mirror in `check-url.mjs` are identical. The parity test is part of the 41 script tests.
  - The API's production origin check and the app's `deploymentProblem` both use the contracts helper.
  - `parent-access-actions.md` A5 now states the procedural gate precisely, and A4 quotes the CORS authorization. The API count is corrected to 354.
- **Not run by me:** Playwright (the lead reports 11/11, with screenshots restored) and a native production prebuild.

## r1 findings
| r1 | Status |
|---|---|
| P2-1: unset env fails open | **fixed**, verified by the probe and `production-config.test.ts` |
| P3-1: loopback https origin | fixed, verified |
| P3-2: loopback and private spellings | fixed, verified (API, app helper, build script) |
| P3-3: `PROD_WEB_DIR` | fixed, verified |
| P3-4: Node check | fixed, verified |
| P3-5: doc accuracy | fixed |

## New findings (non-blocking)

### P3-1: `check-url.mjs` exits 0 without checking when its path isn't byte-identical
- **Where:** `scripts/production/check-url.mjs:41`, the main-module test `import.meta.url === \`file://${process.argv[1]}\``.
- **Scenario (executed):**
  - Invoking the script through a symlink exits **0** for `api http://127.0.0.1`. The direct path exits 1.
  - The same mismatch happens if the repo path contains spaces: `import.meta.url` is percent-encoded and `argv[1]` isn't.
  - `build-web.sh` builds `$REPO` with a logical `pwd`. So a checkout reached through a symlink, or one with a space in its path, skips both the API URL check and the `PROD_WEB_DIR` check.
  - That reopens the `rm -rf` path that P3-3 closed.
- **Mitigation already in place:** the app's runtime `deploymentProblem` check and the bundle greps still block a loopback API.
- **Fix:** compare `realpathSync(fileURLToPath(import.meta.url))` with `realpathSync(process.argv[1])`, or move the CLI into a small separate entry file that always runs. Add a symlink test, as `check-secrets.test.mjs` already has.

### P3-2: document explicit development mode with real providers
- With `POCKETQA_ENV=development` set explicitly, real Firebase and real R2 run with test credits and devnet transfers on. That is by design: it's synthetic-only and used by the live tests.
- Fix: one line in the deploy guide saying never to use it with real users.

## Gates still not run (kept open)
- **Real Firebase sign-in:** access action A1 is not done.
- **The native production prebuild** and its cleartext XML on a device.
- **Native session persistence** (B2).
- **Backup and restore** (B3).
- **Wallet hardware.**

VERDICT: APPROVE
