# pqa-qa verdict: production increment 1, r1 (security and product)

**Candidate:** the `git diff --cached` set in `.worktrees/production-readiness` (30 files, base `9461db5`), described in `inc1-candidate.md`.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*` (apart from the staged `.env.example` diff), `.preview*` or `preview-data`.
- `scripts/preview/*` isn't in the diff (A10).

## What I ran (executable evidence)
- **`pnpm verify` with Node v24.21.0** (the repo's engine range): **EXIT=0**.
  - `check:secrets` scanned 561 files with no findings.
  - Script tests: 39/39.
  - Test counts: contracts 15, domain 170, API 354 passed plus 2 skipped, mobile 714.
- **The same run with the shell's default Node 25.4 failed** in one mobile test (`glass.test.tsx` "grain tile", whose generator output differs by Node version). That's an environment mismatch, not the candidate (P3-4).
- **`PROD_API_URL=/api bash scripts/production/build-web.sh`: EXIT=0.**
  - The secret check found 0 values in 29 files.
  - In the bundle, `PREVIEW_BUILD` is inlined as `!1`, so the demo bootstrap is dead code.
  - There is no loopback API origin and no demo account email in the bundle.
  - The worktree is clean afterwards: the output is git-ignored.
- **A config probe** (a temporary tsx script calling `loadConfig`, then removed). Results are below, and they found P2-1.
  - In production, an emulator host and a raw `FIREBASE_AUTH_EMULATOR_HOST` are both refused.
  - `POCKETQA_ENV=''` and `'Production'` are refused.
  - `https://localhost` and `https://127.0.0.1` **load** as the production origin (P3-1).
  - **With `POCKETQA_ENV` unset and a real Firebase project, real R2 and an https origin, the config loads as `production:false` with `testCredits:true, devnetTransfers:true`** (P2-1).
- **I didn't run** the Playwright suite (the lead's `inc1-playwright.txt` claims 11/11) or a native prebuild in production mode. The candidate itself marks the native prebuild as not yet run.

## Verified as correct
- **Production refusals in `config.ts`, each with a test:**
  - local auth;
  - `demo-` projects, and so every emulator;
  - the shared demo;
  - a missing or non-https origin;
  - local storage;
  - an R2 test endpoint;
  - `RETAIN_NONPROD`;
  - a data dir inside the repo;
  - wallet login without the risk flag.
  
  The bucket pin and the deletion guard from the safety round are intact.
- **`topUp` and the three devnet transfer write routes** refuse with `FEATURE_UNAVAILABLE` before any database write, lookup or chain call. The tests check that the ledger is empty and that publishing fails honestly with `BUDGET_INSUFFICIENT`.
  - Note that these tests flip only `config.features` in `makeApp`, not the full production config. The refusal routes themselves are exercised.
- **The app:**
  - `features` defaults to off when `/config` fails.
  - The funding card's copy is honest.
  - The transfer cards are hidden.
  - The deployment check blocks preview, missing, http and loopback API URLs, and shows the reason instead of starting.
  - Android cleartext is fully off in production.
- **`create-admin` refuses non-local auth before creating the database.** The test checks that no sqlite file appears.
- **No fake success remains on the production paths I traced.**

## Findings

### P2-1: a production deployment that omits `POCKETQA_ENV` silently runs development mode with test top-ups
- **Where:** `apps/api/src/config.ts:82`: `const envName = env.POCKETQA_ENV ?? 'development'`.
- **Scenario (executed in the probe):**
  1. An operator sets the real `pocketqa-optijara` project, real R2 on `pocketqa-evidence` and an https origin, but forgets `POCKETQA_ENV`.
  2. The API starts with `production:false` and `features: { testCredits: true, devnetTransfers: true }`.
  3. Every real builder can mint unlimited test credits (`/me/credits/test-topup`), publish funded studies and pay testers in "credits". The devnet transfer flow is also offered.
  4. The `RETAIN_NONPROD` and local-auth production refusals are skipped too. So real users on real R2 with deletion off (`RETAIN_NONPROD=1`) would also start, which bypasses the rule that real-user cloud mode stays off until the deletion policy.
- **Effect:** this fails open on the parent's acceptance criterion "no production shared-demo shortcuts or test top-ups" and on the deletion-policy gate.
- **Fix (choose one, and test it):**
  - (a) Refuse to start when the config uses real providers (a non-`demo-` Firebase project, or r2 without a loopback test endpoint) unless `POCKETQA_ENV` is set **explicitly**. Live tests and local cloud work would pass `POCKETQA_ENV=development` deliberately.
  - (b) Turn the test features on only with an explicit `POCKETQA_ENV=development`, and treat unset as "no test features".
  - (a) is recommended, because it also keeps `RETAIN_NONPROD` truly synthetic-only.

### P3-1: production accepts a loopback https origin
- `config.ts`'s production check only tests `protocol === 'https:'`, so `https://localhost` and `https://127.0.0.1` load (probe). The error message says "(not localhost)".
- Fix: also refuse loopback hostnames in production, and add them to the test.

### P3-2: the loopback checks miss some spellings
- `build-web.sh` and `deployment.ts` match only `localhost`, `127.0.0.1`, `10.0.2.2` and `[::1]`.
- `https://127.1`, `https://0.0.0.0`, `https://localhost.` and `https://[::ffff:127.0.0.1]` all get through.
- Fix: normalise through `new URL` and refuse the whole `127.0.0.0/8` range, `0.0.0.0`, `::1`, `::ffff:127.*`, a trailing-dot `localhost`, and `10.0.2.2`. Optionally also private ranges.

### P3-3: `build-web.sh` doesn't validate `PROD_WEB_DIR`
- The script runs `rm -rf` on `$OUT.next` and `$OUT.old` under a caller-chosen `PROD_WEB_DIR`, such as `../x` or `.`.
- Fix: require the path to resolve under `apps/mobile/`, and to start with `dist-production`.

### P3-4: verify doesn't check the Node version
- With the default Node 25, `pnpm verify` fails a byte-exact grain test even though `engines` says `<25`.
- Fix: set `engine-strict=true` in `.npmrc`, or add a version check at the top of `verify`, so the mismatch reads as an environment error.

### P3-5: documentation accuracy
- **The candidate's API count is wrong.** `inc1-candidate.md` says "API 353 + 2 skipped", but its own `inc1-pnpm-verify.txt` and my run both show **354** plus 2.
- **`parent-access-actions.md` A5 misstates the gate.** It says production "refuses to start for real users (the RETAIN_NONPROD gate)". In production, `RETAIN_NONPROD` is refused outright and `ALLOW_DELETE=1` is required. So the gate is procedural: setting `ALLOW_DELETE=1` is prohibited until Hamza decides. Say so precisely, and close the unset-env path (P2-1).
- **A4 calls the bucket CORS change "non-destructive; authorized".** It is a bucket config change. Before the lead applies it, quote where the parent or Hamza authorized it.

## Gates still not run (kept open)
- **Real Firebase sign-up and sign-in:** Auth still returns `CONFIGURATION_NOT_FOUND` (access action A1).
- **A native production prebuild and its cleartext XML on a device.**
- **Native session persistence** (my B2).
- **Backup and restore** (my B3).
- **Wallet hardware.**

VERDICT: CHANGES_REQUIRED
