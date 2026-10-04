## Cloud backend: managed identity (Firebase), wallet-first login, private evidence storage (R2), web wallet

Implements `docs/plans/backend-cloud-auth-wallet-plan.md`, Phases 1–3 code (decisions: `docs/decisions/0005-cloud-identity-storage-wallet.md`).

**Every provider mode is off by default.** Defaults stay local auth, local storage and no wallet login. The shared demo is pinned to local mode, and its gate blocks every new route.

**Nothing was provisioned:**
- no Firebase project, R2 bucket, hosting or DNS was created;
- no payments and no mainnet;
- the live demo was not touched.

### Increments (each independently security-reviewed by pqa-qa, read-only)

| Commit | Scope | Review |
|---|---|---|
| `f655d8f` | API managed identity: Firebase ID tokens (revocation-checked, plus a server-side `valid_after`), UID-to-user mapping, roles and suspension stay server-side, no email auto-merge, verified email required, one account system per deployment, emulator and unsigned-token guards | r1 CHANGES_REQUIRED, then r2 APPROVE |
| `1d8d9dd` | API wallet-first login: separate challenge store, bound to the deployment's real origin, single use, rate-limited, no hijack, admins excluded, custom token never a bearer, last sign-in method protected | r1 CHANGES_REQUIRED (phishing/origin P2), then r2 APPROVE |
| `fe0d91d` | Private evidence storage: storage interface plus R2 adapter, upload intents with a quarantine key and presigned PUT, verified completion (real size, sniffed type, ETag-pinned promotion to an immutable key), quota reservations, submission blocked while uploads are pending, deletion outbox and sweep, authenticated ranged playback | r1 APPROVE (P3s), then r2 APPROVE |
| `e0112f9` | Clients and docs: Firebase client (email and Google, custom-token exchange, tab-scoped persistence, refresh on 401), web Wallet Standard login (`solana:signIn` only) and origin-bound linking, honest config-derived copy, preview blocks, `docs/deploy/cloud-backend.md` | r1 CHANGES_REQUIRED (2 P2), then r2 APPROVE |

Every verdict is in `docs/reviews/cloud/` (`inc*-verdict-qa-r*.md`), next to the candidates and evidence.

### Test evidence (local, final tree)
- **`pnpm verify`** EXIT=0: secrets scan clean; contracts 15; domain 170; API 337 plus 2 emulator-only; mobile 709; root scripts 37.
- **`pnpm test:emulator`** (Firebase Admin ↔ Auth emulator, `demo-pocketqa`, no account): 2/2.
- **`pnpm test:e2e:firebase`** (browser ↔ Firebase client ↔ API in firebase mode, Auth emulator): 2/2.
- **Playwright** (`apps/mobile`): 11/11, including:
  - wallet login and linking with a domain-checking test Wallet Standard wallet;
  - the corrected theme test. It was failing on `origin/main` after the Lens UI merge, because Lens paints the ground on an ancestor. The fix is test-only and was validated by the reviewer.
- **Mutation checks:** I1–I6, W1–W8, S1–S9, C1–C7 and others, recorded in the candidates.
- R2 is tested through the real adapter against a local fake S3, which doesn't verify signatures.

### Live provider verification (2026-10-04, dedicated resources only)
- **Cloudflare R2: verified** against the dedicated bucket `pocketqa-evidence` (`apps/api/test-live/r2.live.test.ts`, 5/5). The run was **create-only**: deletes were intercepted and refused, and the test is pinned to that bucket and to the Optijara account by hash.
  - Real presigned PUT, HEAD and ranged read.
  - R2 refuses a PUT with a different length or type (signed headers are enforced).
  - The ETag-pinned copy works, and a stale ETag gives 412.
  - An anonymous GET is refused.
  - The full API flow works (intent, PUT, verified completion, promotion, ranged playback, spoofed type rejected).
  - 5 synthetic objects were created and none deleted (`docs/reviews/cloud/live/r2-objects-created.md`).
  - The credentials used were account-level, loaded in-process and never printed. **Production needs a bucket-scoped token.**
- **Firebase: partly verified.**
  - The project `pocketqa-optijara` is visible, and Pocket QA's own web app was created.
  - **Firebase Authentication is not initialised** (`CONFIGURATION_NOT_FOUND`). On the free plan only the console can initialise it, and the API route needs billing.
  - The live test is ready, and fails at exactly that point. No users were created.
- Live suites are excluded from `pnpm verify` and CI (`pnpm --filter @pocket-qa/api test:live`). Review: `docs/reviews/cloud/live-verdict-qa-r1.md` (APPROVE).
- **Post-approval safety fixes** (no R2 deletion, fail-closed account deletion, bucket pin, no personal tokens): `safety-verdict-qa-r1` CHANGES_REQUIRED, then `safety-verdict-qa-r2` APPROVE.

### Remaining user actions (exact)
1. Firebase console → `pocketqa-optijara` → Authentication → **Get started**, then enable Email/Password.
2. A dedicated service identity for the Admin SDK (no billing change): enable the IAM and IAM Credentials APIs, create `pocketqa-api@pocketqa-optijara.iam.gserviceaccount.com` with `roles/firebaseauth.admin` on the project, plus `roles/iam.serviceAccountTokenCreator` on itself only (for wallet-login custom tokens). Exact steps: `docs/deploy/cloud-backend.md`. Personal login tokens are not used.
3. A bucket-scoped R2 token for `pocketqa-evidence` (Object Read & Write).
4. Approval for the bucket CORS change (`PUT` from the exact app origin).
5. **A decision on R2 deletion.** No lifecycle or expiry rule is set or recommended. By default the r2 adapter refuses every delete (`POCKETQA_R2_ALLOW_DELETE` off) and keeps it in the outbox. Quarantine copies are retained. **Real-user cloud mode is off until a deletion policy is approved:**
   - r2 refuses to start without `POCKETQA_R2_ALLOW_DELETE=1` (approved), or `POCKETQA_R2_RETAIN_NONPROD=1` (synthetic data only).
   - With deletion off, account deletion is refused, never reported as done.
   - Enabling deletion drains the queued backlog.
   - The app's bucket is pinned to `pocketqa-evidence`.

### Gates NOT passed (real providers and hardware)
1. **Firebase:** Authentication isn't initialised in `pocketqa-optijara` (user action 1). Untested: real email/Google sign-in, and the Admin service account.
2. **Cloudflare R2:** the bucket and the signed-header enforcement are verified live. Still open: a bucket-scoped token, CORS for browser PUT, the deletion decision (user action 5), and real-device uploads.
3. **Hosting:** TLS endpoint, trusted proxies, CORS or same-origin `/api`, a single sweep runner, database choice.
4. **Wallets:**
   - real Wallet Standard browser wallets have not been tested;
   - **Hamza's acceptance of the residual raw-`signMessage` phishing risk is not recorded**, so wallet login must stay off outside localhost;
   - Android wallet login is not offered (MWA linking only);
   - physical-device and real-wallet tests are still release gates.
5. **Native clients in firebase mode:** not production-ready, because the Firebase JS SDK on React Native needs a persistence setup.

### Known follow-ups
- A wallet chooser when several wallets are installed.
- Show that account deletion is unavailable (`canDelete`) before the confirmation sheet. This only matters in synthetic `RETAIN_NONPROD` mode.
- MP4/WebM structural validation beyond the 16-byte signature check.
- Multipart/resumable uploads over 100 MB.
- A shared rate-limit store and a sweep lease for multi-instance hosting.

### Post-merge cutover for the live preview (parent; it runs from `main`)
1. `pnpm install --frozen-lockfile` (new dependencies; the cloud SDKs are loaded only in their modes).
2. Back up `preview-data/pocketqa.sqlite`. Migrations 1–3, which only add tables, run on the next API start.
3. `scripts/preview/build-web.sh` (new client; the preview build keeps wallet linking hidden).
4. A coordinated restart of the preview gate and API with the same environment (`start.sh` pins local auth, local storage and no wallet login).
5. `scripts/preview/smoke.mjs` and `apps/mobile/e2e/preview/browser-smoke.mjs` (with `PREVIEW_EXPECT_CONVENIENCE=1` if the shared-demo convenience is on).

**Do not merge** until the parent's verification. Enabling any provider mode needs the gates above.
