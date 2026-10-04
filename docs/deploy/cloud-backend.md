# Cloud backend: environment, provider setup and gates

Status, 2026-10-04:
- The code is implemented and tested locally.
- Hamza and the parent created a dedicated Firebase project `pocketqa-optijara` and a dedicated R2 bucket `pocketqa-evidence`. See the live verification below.
- No hosting or DNS was provisioned, and no billing was enabled. Decision record: `docs/decisions/0005-cloud-identity-storage-wallet.md`.

## Live verification (2026-10-04)

**Cloudflare R2: verified against the dedicated bucket `pocketqa-evidence`** (`apps/api/test-live/r2.live.test.ts`, 5/5). The run was create-only: every delete was intercepted and refused.
- A real presigned PUT, HEAD and ranged read.
- **R2 enforces the signed headers:** a PUT with a different length or type is refused, and nothing is created.
- An ETag-pinned copy works; a stale ETag gives 412 (`StorageChanged`).
- An anonymous GET is refused, so the objects are private.
- The full API flow (intent, presigned PUT, verified completion, promotion, ranged playback) works, and a spoofed type is rejected.

Objects created: `docs/reviews/cloud/live/r2-objects-created.md` (5 synthetic fixtures; removing them needs Hamza's approval).

The credentials used for the run were the account-level ones from the authorized env file, loaded in-process and never printed. **Production must use a bucket-scoped token instead.**

**Firebase: partly verified.**
- The project is visible to the Firebase CLI.
- Pocket QA's own **web app** was created (`Pocket QA Web`). Its public SDK config is kept outside git in `.cloud-local/firebase-web.json` (0600).
- **Firebase Authentication is not initialised** in the project: `accounts:signUp` and `createAuthUri` both return `CONFIGURATION_NOT_FOUND`.
  - On the free plan, only the console can initialise it. The API route (`identityPlatform:initializeAuth`) upgrades to Identity Platform and needs billing, which is not authorised.
  - The live test (`apps/api/test-live/firebase.live.test.ts`) is ready, and fails today with exactly that error. It created no users.

### Remaining user actions, in order
1. **Firebase console** → `pocketqa-optijara` → Authentication → **Get started**. Under Sign-in method, enable **Email/Password**; Google is optional (it needs a support email). This is free and needs no billing. Then the live Firebase test can run.
2. **Server credential (Admin SDK)** for any hosted API:
   - Enable the IAM API in `pocketqa-optijara` (it's off today).
   - Create a dedicated service account (for example `pocketqa-api`) with `roles/firebaseauth.admin`, plus `roles/iam.serviceAccountTokenCreator` on itself so it can sign custom tokens for wallet login.
   - Prefer workload identity; otherwise keep a key only in the host's secret store.
   - The `gcloud` Optijara account needs interactive re-authentication first (`gcloud auth login <account> --no-activate`, which doesn't switch the global account).
3. **R2 production token:** in the Cloudflare dashboard, create an R2 API token scoped to **`pocketqa-evidence` only**, with Object Read & Write.
4. **R2 bucket settings** (each a change to the bucket's config, so approval is required):
   - a CORS rule allowing `PUT` from the exact app origin, with header `content-type`;
   - a lifecycle rule expiring `quarantine/` after 1 day.
   - Browser direct uploads can't work until CORS is set; server-side and Node uploads already work.

### Running the live tests (credentials only from the environment; excluded from `pnpm verify`/CI)
```sh
POCKETQA_LIVE_R2=1 POCKETQA_R2_ACCOUNT_ID=… POCKETQA_R2_BUCKET=pocketqa-evidence POCKETQA_R2_ACCESS_KEY_ID=… POCKETQA_R2_SECRET_ACCESS_KEY=… \
  pnpm --filter @pocket-qa/api test:live -- test-live/r2.live.test.ts           # refuses any other bucket/account; never deletes
POCKETQA_LIVE_FIREBASE=1 POCKETQA_FIREBASE_PROJECT_ID=pocketqa-optijara POCKETQA_FIREBASE_WEB_API_KEY=… GOOGLE_APPLICATION_CREDENTIALS=… \
  pnpm --filter @pocket-qa/api test:live -- test-live/firebase.live.test.ts      # refuses any other project; never deletes
```

## Feature flags (all off by default)

| Variable | Values | Notes |
|---|---|---|
| `POCKETQA_AUTH_MODE` | `local`, `firebase` | `firebase`: the API accepts only verified Firebase ID tokens. Local password sign-up and sign-in are refused. |
| `POCKETQA_FIREBASE_PROJECT_ID` | project id | Required in firebase mode. |
| `POCKETQA_FIREBASE_WEB_API_KEY`, `POCKETQA_FIREBASE_AUTH_DOMAIN` | public web config | Served to clients by `GET /config`. These are public identifiers, not secrets. |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to a service-account JSON | Firebase Admin only. Keep it in the host's secret store; never in the repo or logs. Workload identity is preferred. |
| `POCKETQA_FIREBASE_AUTH_EMULATOR_HOST` | `127.0.0.1:9099` | Local tests only, and only with a `demo-` project. A stray raw `FIREBASE_AUTH_EMULATOR_HOST` refuses startup, because it would accept unsigned tokens. |
| `POCKETQA_WALLET_LOGIN` | `0`/`1` | Wallet-first login. Needs `POCKETQA_PUBLIC_ORIGIN`. See its enabling conditions below. |
| `POCKETQA_PUBLIC_ORIGIN` | e.g. `https://app.example` | The exact https origin of the web app (http only for localhost). It becomes the SIWS domain and URI. |
| `POCKETQA_STORAGE` | `local`, `r2` | `r2`: direct uploads to a private bucket. |
| `POCKETQA_R2_ACCOUNT_ID`, `POCKETQA_R2_BUCKET` | 32-hex id, bucket name | Required for r2. |
| `POCKETQA_R2_ACCESS_KEY_ID`, `POCKETQA_R2_SECRET_ACCESS_KEY` | bucket-scoped token | Server-only secrets, set in the host's secret store. |
| `POCKETQA_SHARED_DEMO` | `0`/`1` | The shared synthetic preview only. It refuses firebase mode, r2 and wallet login. `scripts/preview/start.sh` pins all four. |

## Firebase setup (gate 1: needs a verified Optijara project)
1. The dedicated project `pocketqa-optijara` exists and the Firebase CLI lists it (verified 2026-10-04). Never print `firebase login:list --json` raw, because it contains tokens.
2. Use separate staging and production projects. Enable the **Email/Password** and **Google** providers only, since the API refuses others. Require email verification (the API enforces it as well).
3. Authorized domains: the exact app origins only.
4. Give the API host a service account with the minimum role (Firebase Authentication Admin), or workload identity.
5. Gate check: sign up, verify the email, choose a role, sign in, and log out on every device. A token from before logout must be refused. Run a Google sign-in on the real domain.

## Cloudflare R2 setup (gate 2: needs a verified Optijara account)
1. The dedicated bucket `pocketqa-evidence` exists and was verified live (2026-10-04; see Live verification). `wrangler` itself is unauthenticated; the S3 API with account credentials works.
2. Create **private** buckets for staging and production, with public access and the `r2.dev` URL off.
3. Create an API token scoped to that one bucket with Object Read & Write. Store it in the host's secret store.
4. Add a CORS rule on the bucket. It must allow `PUT` from the exact app origin(s) only, with request header `content-type`, and no wildcards.
5. Add a lifecycle rule as a backstop to the API's sweep: abort incomplete uploads, and expire `quarantine/` objects after 1 day.
6. Gate check, recording the evidence:
   - a presigned PUT with a different length or type is refused;
   - only the exact origin passes CORS;
   - an anonymous GET of the object is refused;
   - completion, playback with seeking, and account deletion all work against real objects;
   - object metadata is read back.

## Hosting (gate 3)
- The API binds to loopback (`loadConfig`). Put a TLS reverse proxy in front.
  - Configure trusted proxies before relying on per-client rate limits. With `trustProxy: false`, every client behind the proxy shares one key.
- In-process state: wallet-login rate limits, the storage sweep and the deletion outbox. Run **one** API instance, or add a shared store plus a sweep lease, before scaling out.
- Database: SQLite, single writer. Moving to managed PostgreSQL is a separate decision (plan Phase 4), as are backups and a restore drill.
- Native app: set the API URL to the TLS endpoint, not `adb reverse`.
- **CORS.** The API's CORS allows only `localhost`/`127.0.0.1` origins (`apps/api/src/app.ts`). A hosted web app must either reach the API **same-origin** (recommended: a reverse proxy serving `/api` from the app's origin, as the preview gate does), or the API's CORS must be configured for the exact app origin. Never use a wildcard.
- **Firebase web persistence** is tab-scoped (`browserSessionPersistence`): closing the tab signs out, and the refresh token isn't kept in IndexedDB. Revisit this only together with a decision on shared-computer risk.

## Wallet login: conditions before enabling anywhere but localhost
- Hamza's explicit acceptance of the residual raw-`signMessage` phishing risk must be recorded in ADR 0005 §2. **It isn't recorded yet.**
- A verified production origin must be set in `POCKETQA_PUBLIC_ORIGIN`.
- Real-wallet test: sign in on the configured origin, and confirm the same wallet refuses or warns on a different origin.
- Android: not offered (MWA linking only).

## Known follow-ups (not blockers)
- **Wallet chooser.** With several Wallet Standard wallets installed, web login and linking use the first one. Add a chooser.

## Local verification commands
```sh
pnpm verify                 # unit/integration: API with fake Firebase and fake S3, app, contracts, scripts
pnpm test:emulator          # API ↔ Firebase Admin against the Auth emulator (demo-pocketqa)
pnpm test:e2e:firebase      # browser ↔ Firebase client ↔ API in firebase mode (Auth emulator)
(cd apps/mobile && npx playwright test)   # web E2E incl. Wallet Standard login (test wallet)
```
