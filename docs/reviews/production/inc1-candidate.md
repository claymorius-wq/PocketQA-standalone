# Candidate: production increment 1 (production-mode spine)

**Base:** `9461db5` (`origin/main`, verified). **Branch:** `feat/production-readiness`. The changes are uncommitted and frozen for review.

**Numbering:** the A-numbers in `parent-access-actions.md` are access actions. pqa-qa's `qa-ledger.md` A-numbers are acceptance criteria.

**Scope:** ledger rows I1, D1–D4, O5 (code part), O9.
- The preview demo is unchanged and stays an isolated fixture (D5): `scripts/preview/start.sh` pins development mode.
- Nothing in `scripts/preview/*` was edited.

## Changes

### API config: `POCKETQA_ENV=development|production`
`apps/api/src/config.ts` and `test/production-config.test.ts`. Any other value refuses startup. Production refuses:
- `POCKETQA_AUTH_MODE=local`;
- `demo-` Firebase projects, and therefore every emulator host, since the emulator was already limited to `demo-` projects;
- the shared demo;
- a missing or non-https `POCKETQA_PUBLIC_ORIGIN`;
- `POCKETQA_STORAGE=local`;
- an R2 test endpoint;
- `POCKETQA_R2_RETAIN_NONPROD`;
- a data dir inside the repo (dev `.data` and the demo `preview-data`);
- wallet login without `POCKETQA_WALLET_LOGIN_RISK_ACCEPTED=1`.

Two consequences follow:
- **Production plus r2 needs `POCKETQA_R2_ALLOW_DELETE=1`.** That is still prohibited until Hamza decides on deletion (A5), so production can't start for real users today. This is deliberate (ledger S5).
- **`features: { testCredits, devnetTransfers }`** are both false in production and true in development.

### Contract v0.5.0
- `ClientConfig.features`.
- `FEATURE_UNAVAILABLE` (403).
- Logged in `docs/decisions/contract-changes.md`.

### Handlers
- `topUp` refuses with `FEATURE_UNAVAILABLE` when test credits are off, and posts nothing.
- `createTransfer`, `submitTransferSignature` and `transferBlockhash` refuse before any lookup or chain call when devnet transfers are off.
- The read routes still work and return nothing new in production.
- Test: `test/production-features.test.ts`, which also shows that publishing then fails honestly with `BUDGET_INSUFFICIENT`.

### Admin script (D2)
`create-admin.ts` refuses when auth isn't local, before touching the DB (`test/admin-scripts.test.ts`). Together with production refusing local auth, which rejects the demo seed's `/auth/register`, no demo account or admin can be seeded into production. A production admin path (`admin:grant`) comes in increment 2.

### App
- **`SessionProvider` exposes `features`.** It defaults to off if `/config` can't be read.
- **Credits screen:** builders see "Funding isn't available yet" instead of the top-up card when test credits are off.
- **Transfer cards** are hidden when devnet transfers are off (builder review and tester session).
- **Production build check.** `src/lib/deployment.ts` (with `__tests__/deployment.test.ts`) and `app/_layout.tsx` stop a production build (`EXPO_PUBLIC_POCKETQA_ENV=production`) from starting if any of these hold:
  - it was built with the preview demo;
  - it has no API URL;
  - the API URL is not https;
  - the API URL is loopback or `10.0.2.2`.
  
  Web may use same-origin `/api`. Instead of starting, the app shows the reason.
- **Android cleartext:** `plugins/withLocalhostCleartext.js` writes a network security config with **no** cleartext domains when the prebuild runs with `EXPO_PUBLIC_POCKETQA_ENV=production`. Development keeps loopback.

### Production web build
`scripts/production/build-web.sh`, tested by `scripts/production-scripts.test.mjs`. It refuses:
- `EXPO_PUBLIC_PREVIEW`;
- a missing, plain-http or loopback `PROD_API_URL`;
- a bundle that contains a loopback API origin or a synthetic demo account.

It also runs the preview secret scan. Output goes to `apps/mobile/dist-production/`, which is git-ignored and ignored by ESLint.

## Evidence
- `pnpm verify`: EXIT=0.
  - Secrets scan: 556 files.
  - Script tests: 39.
  - Test counts: contracts 15, domain 170, API 354 plus 2 skipped, mobile 714.
- `PROD_API_URL=/api bash scripts/production/build-web.sh`: EXIT=0.
  - The secret check found 0 values in 29 files.
  - The loopback-origin and demo-account greps were clean.
- `admin:create` refusal: `apps/api/test/admin-scripts.test.ts`.
- Playwright (`apps/mobile`): 11/11, `PW_EXIT=0` (`inc1-playwright.txt`). The devnet-transfer spec still passes in development mode.
- Not yet run: the native prebuild with `EXPO_PUBLIC_POCKETQA_ENV=production`. It's planned for the native increment.

## Review asks
- Can any production config still reach a demo, local-auth, emulator, test-credit or devnet-transfer path?
- Does anything in production still fall back to a fake success?
- Is the r2 deletion consequence stated honestly?
- Do the deployment checks hold on native, given that `process.env.EXPO_PUBLIC_*` is inlined at bundle time?

## r1 fixes (after `inc1-verdict-qa-r1` CHANGES_REQUIRED)
- **P2-1 (fail closed).** `loadConfig` refuses a real Firebase project (not `demo-`) or real R2 (no loopback test endpoint) unless `POCKETQA_ENV` is set **explicitly**. Real providers can therefore never fall into development's test credits, demo transfers or retention-only R2.
  - The live tests pass `POCKETQA_ENV=development` deliberately (synthetic data).
  - Test: `production-config.test.ts` "real providers without an explicit POCKETQA_ENV refuse to start".
- **P3-1 and P3-2 (loopback and private spellings).** One `isPublicHost` helper in `packages/contracts`, with contracts tests, is used by the API's production origin check and by the app's `deploymentProblem`. `scripts/production/check-url.mjs` mirrors it for the build script, and a parity test uses the same cases.
  - Refused: `127.0.0.0/8`, `0.0.0.0` and `0`, `10/8` (including `10.0.2.2`), `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`.
  - Also refused: `localhost`, `localhost.` and `*.localhost`, `::1`, `::`, `::ffff:*` (mapped), `fc00::/7` and `fe80::/10`.
  - `new URL` normalises forms such as `127.1` and `2130706433`.
- **P3-3.** `PROD_WEB_DIR` must resolve to exactly `apps/mobile/dist-production`; anything else is refused before any `rm -rf`. Covered by a test.
- **P3-4.** `pnpm verify` now starts with `scripts/check-node.mjs`, which fails fast outside `engines.node` (confirmed: Node 25.4 → exit 1 with a clear message).
- **P3-5.**
  - The API count is corrected to 354.
  - `parent-access-actions.md` A5 now states the gate precisely: `RETAIN_NONPROD` is refused in production, and `ALLOW_DELETE=1` is required but prohibited until Hamza decides, which is a procedural gate.
  - A4 quotes its CORS authorization: the parent's 2026-10-04 relay, "including exact-origin CORS". It is applied only after the origin is confirmed.

## r2 follow-ups
- `inc1-verdict-qa-r2` APPROVE. Both non-blocking P3s are fixed:
  - **P3-1.** `check-url.mjs` compares the real paths of `import.meta.url` and `argv[1]`, so a symlinked checkout or a path with spaces still runs the check. Covered by a symlink-with-spaces test.
  - **P3-2.** The deploy guide's "Production mode" section says never to use `POCKETQA_ENV=development` with real users.
