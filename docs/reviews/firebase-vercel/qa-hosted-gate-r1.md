# pqa-qa: P5 hosted gate r1. Checks that need no accounts, on https://pocketqa.vercel.app

**Deployment under test:** `dpl_9sSVSGkBhQbobdeRAdvR4xBQtbXn`, built from `f66469f` (code `ef18694`), per the lead.

**My limits:** no accounts created, no secrets read, no writes. Public HTTPS requests only, from this machine, on 2026-10-06.

## Results
| Check | Method | Result |
|---|---|---|
| **Headers** | `node` fetched `/`, `/sign-in`, `/no/such/deep/link`, `/api/health`, `/api/config` and `/api/me`, and compared each header **exactly** with `securityHeaders()`, `hostedAppCsp(account, bucket)` and `API_CSP` imported from `scripts/production/security-headers.mjs` / `scripts/vercel/config.mjs` at `f66469f` | **ALL MATCH.** The app CSP is narrowed to `…r2.cloudflarestorage.com/pocketqa-evidence/`. `/api` has `default-src 'none'; sandbox` and `cache-control: no-store`. SPA deep links return 200 |
| **Unauthenticated and forged-token matrix** | **All 65** non-public contract routes (with `:params` set to dummy ids) × 5 credentials: none, garbage, an `alg:none` forged Firebase JWT, an HS256 forged JWT, and an RS256 JWT with a fake `kid` and a random signature. 325 requests, paced | **All refused.** 260 × **401** from the API. 65 × **403** for the `alg:none` tokens, from **Vercel's edge** (a platform `Forbidden` body, before the function). Nothing returned 2xx, 404 or 5xx |
| **Cron** | `/api/jobs/{sweep,settle,bogus}` with no auth, a wrong `Bearer`, or a random 40-character `Bearer`; `POST /api/jobs/sweep`; `/api/jobs` | **404** `{"code":"NOT_FOUND","message":"Route not found."}` every time, byte-identical to an unknown API route, so the route isn't advertised |
| **Served-asset secret scan** | Downloaded `index.html` plus the single entry bundle (5.9 MB); counted marker patterns (`-----BEGIN`, `private_key`, `client_email`, `FIREBASE_SERVICE_ACCOUNT`, `R2_SECRET`, `R2_ACCESS_KEY`, `CRON_SECRET`, `service_account`, `POCKETQA_R2`, `secretAccessKey`, `accessKeyId`); fetched the source map | **0 hits** for every marker. `*.js.map` returns **403** (not served). Raw 64-hex and 32-hex runs exist (library hashes, plus the public R2 account id in the CSP); they can't be told apart from values without the secrets, so the authoritative check is the deploy's value scan ("4/4 variables, 7 values checked") |
| **Live app in Chromium, zero CSP violations?** | Real Chromium loading `/` and `/sign-in` (no sign-in), listening for `securitypolicyviolation` events | **FAIL.** See P1-H1 |

## P1-H1: the production web bundle calls a loopback test API, so the hosted web app can't reach its own API
**What the browser shows:** on both `/` and `/sign-in`, Chromium reports:
```
CSPV connect-src http://127.0.0.1:18887/config
Refused to connect because it violates the document's Content Security Policy.
```
**What the bundle contains:** the served `entry-39ed9b5b….js` holds **`http://127.0.0.1:18887`** (2 occurrences) and **no `"/api"`**.

**Why it happened (from the code):**
- `scripts/vercel/build.mjs:84–88` sets `EXPO_PUBLIC_API_URL='/api'`, then runs `pnpm --filter @pocket-qa/mobile build:web`.
- `build:web` is `expo export --platform web --output-dir dist-web` **without `--clear`**. Expo inlines `EXPO_PUBLIC_*` at transform time, and Metro's transform cache reused a bundle from an earlier e2e run. The Playwright config exports with `EXPO_PUBLIC_API_URL=http://127.0.0.1:${PQA_E2E_API_PORT}` (18887).
- So the deployed bundle carries a **test-run loopback URL**.

**Impact:**
- **The hosted web app can't load `/config` or call any API.** Sign-in, studies, everything is broken on the web.
- **The page CSP blocked it,** which is good.
- **The deploy evidence missed it:** the secret scan and the headers looked fine.
- **Native APK builds** from the same machine could inherit a stale `EXPO_PUBLIC_*` the same way. The existing deployment check refuses http or private hosts for APKs, but confirm it covers this path.

**Required:**
1. The deploy web export must run with `--clear` (or a fresh `TMPDIR`/Metro cache), every time.
2. **A post-build assertion in `build.mjs --deploy`:** the bundle contains the expected API base (`"/api"`) and **no** `127.0.0.1`, `localhost` or private-network API base. Fail the deploy otherwise.
3. **Tests:** plant a stale-cache scenario (export with a loopback URL, then a deploy build) and show it now fails the assertion or produces `/api`.
4. **Redeploy,** then **my live re-check:** zero CSP violations and `/api/config` fetched by the page.

## Not covered yet (known, by design)
- **Browser uploads:** blocked by bucket CORS (lead's gap a). Native is unaffected.
- **Authenticated flows:** they need the migrated-account claim (gap b).
- **The real migration** (gap c): I review be1's real-mode diff first, then do the post-run check.

## TTL fieldOverrides not deployed (403, billing disabled)
**Effect:**
- **Expired records stay:** `idempotency`, `rateLimits` and `jobLeases` documents are never auto-removed by Firestore.
- **Correctness is safe:** the TTL is checked on read, so this only grows storage.

**Accepted for now** at test scale (P3). The sweep job should remove them, or the TTL policy should be deployed once billing allows it.

**Hosted gate r1 verdict:** CHANGES_REQUIRED (P1-H1).

## r2: P1-H1 re-check on the redeploy `dpl_DF68zX8zboPNNpfRYjVkDMFLPwSP` (fix `d58d918`)
- **Chromium, live:** `/` and `/sign-in` give **0 CSP violations**, 0 console errors and 0 failed requests; the only origin contacted is `https://pocketqa.vercel.app`. The page fetched **`GET /api/config 200`**.
- **Served bundle:** `/_expo/static/js/web/entry-12b859d1….js` contains `"/api"` (2×) and **no `127.0.0.1:<port>`** API base. What's left are library constants: one `http://127.0.0.1:` template prefix and `http://localhost` (4×). That matches the bundle-check allowlist the lead described.
- **P1-H1: fixed.** The headers, auth matrix, cron and secret-marker results from r1 stand; the code under test is unchanged.

**Hosted gate (no-account part): PASS.** Still open:
- browser uploads (blocked by bucket CORS, gap a);
- authenticated flows after the migration claim (gap b);
- the post-migration check (gap c).
