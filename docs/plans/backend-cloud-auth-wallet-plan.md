# Pocket QA: cloud backend, accounts, R2 and wallet UX

Status: proposed; audit and plan only. Author: Malik. Based on inspected main code at 1b8385c and CLI checks in this session. No cloud provisioning, application edits or payments authorized by this document.

## Requested outcome
Store consented evidence videos in Cloudflare R2 under the verified Optijara account; introduce managed account authentication (Firebase recommended); make wallet connection and login coherent; identify backend gaps while the other contributor works on UI. No screenshots were provided for this feedback.

## Verified current state
- `apps/api/src/handlers/account.ts`: custom password auth, hashed opaque sessions, local in-memory login throttle, role-based accounts, export/deletion and test credits. Firebase is not the current auth provider. AI status explicitly returns unavailable.
- `apps/api/src/db.ts`: better-sqlite3 database, relational studies/participations/evidence, append-only reward ledger, wallet links and devnet transfers. Firebase Auth need not imply Firestore migration.
- `apps/api/src/handlers/evidence.ts`: streaming upload to local filesystem, content signature checks, per-participation authorization, quotas, transactional race rechecks and authenticated range playback. Not R2.
- `scripts/preview/gate-server.mjs`: shared synthetic preview, uploads/deletion/moderation disabled. Prefilled shared accounts are not suitable for real recordings or private customer data.
- `apps/api/src/handlers/wallet.ts`: authenticated account linking with single-use nonce and signature verification; unique wallet ownership. Does not establish a new app login. Devnet transfer intents exist, not a production payout system.
- `apps/mobile/src/wallet/link.android.ts`: Android MWA authorize then sign-message linking. `link.ts` explicitly rejects web/iOS. Therefore wallet connection is not available on the public web preview today.
- `apps/api/src/config.ts`: loopback-only Node API with local data directory. Tunnel exposure is not durable cloud hosting.
- Existing review/dispute/study logic is real and should be preserved, not rebuilt.
- `docs/progress.md` contains historical contradictions (some completed features still labelled missing); prefer source and new test evidence. Physical-device/real-wallet and funded confirmed devnet transaction remain release gates, not newly reverified here.

## CLI/access findings
- Firebase CLI installed; Optijara-domain login is listed, but project listing fails, including explicit account selection. Do not select/create a project until access is repaired and ownership verified.
- Wrangler not globally available; `npx --yes wrangler whoami` works but reports unauthenticated. Existing cloudflared tunnel authentication does not establish R2 management access.
- Exact Optijara Cloudflare account, R2 entitlement/billing and Firebase project are unverified. No bucket/project was created.
- Operational caution: Firebase `login:list --json` can emit credential material, not just account identities. Never log its raw result again; filter inside the subprocess. Revoke/reauthenticate the exposed CLI session as a separate coordinated security action; do not copy tokens to documents or messages.

## Recommended architecture
Firebase Auth for identity; existing Node API for authorization and business rules; private R2 for evidence; relational database for transactional studies/ledger. Recommend managed PostgreSQL before multi-instance production. A backed-up single-writer SQLite pilot is possible only as an explicit deployment decision. Do not force existing synchronous SQLite code into Workers or rewrite ledger semantics in Firestore merely to use Firebase Auth.

### Unified account and wallet UX
1. Offer email/Google sign-in and, when implemented/tested, Continue with wallet. Same underlying account regardless of entry point.
2. Email/Google: Firebase client signs in; API verifies Firebase ID token and maps UID to immutable internal user ID. Server controls roles and suspensions; no client-assigned admin claims.
3. Connect wallet while logged in: show address/network and request a purpose-bound signature. Existing account + fresh wallet proof creates unique link. Never auto-merge accounts based on wallet text, display name or email alone.
4. Wallet-first login: separate login challenge endpoint, not reuse authenticated link nonce. Bind unpredictable single-use challenge to exact message, domain/URI, expiry, purpose and intended network context; rate limit and consume atomically. Verify signature server-side, resolve or create canonical account, then mint Firebase custom token for that UID. Client exchanges custom token for Firebase session; API accepts verified ID tokens, not custom tokens as API bearer credentials.
5. Existing-wallet conflict: require proof of both accounts and explicit merge workflow; otherwise refuse. Recovery email/provider encouraged; do not allow unlink of last login method without replacement and recent reauthentication.
6. Disconnect wallet session, unlink identity and logout are separate actions. None sends funds. Transfer requires separate informed approval and chain confirmation.
7. Android: retain MWA adapter. Web: implement and test Solana Wallet Standard connector. iOS: research supported wallet/browser/deep-link path separately; do not claim Android MWA applies there.

### Private R2 evidence flow
- Verify Optijara account and separate staging/production buckets; public access off; least-privilege bucket credentials held only server-side.
- Add storage interface, retaining local adapter for tests. Map changes to evidence handler, context/config, account deletion and evidence contracts.
- Create upload intent only for authorized tester/in-progress participation with accepted consent. Server-generated opaque object key, quota reservation and idempotency key; never client-selected path.
- Short-lived presigned PUT or multipart upload; exact-origin CORS. Presigned URL is a bearer capability and not single-use by itself. Content-Type signing does not prove actual bytes or enforce all quota limits.
- Complete upload server-side: verify object existence, real size/checksum and file content/container; enforce quotas and participation state again. Quarantine until validated. Prevent post-validation overwrite via immutable final object key/promotion. Persist ready state only after validation; reconcile failed DB/object operations.
- Retry/resume/cancel visible in UI. Submission blocked while media pending. Abort abandoned multipart uploads and delete orphans through durable jobs.
- Playback: preserve existing permission recheck and byte-range support through authenticated API/worker streaming. Direct short-lived GET URLs are possible, but would weaken immediate logout/revocation guarantees until expiry; do not silently downgrade current behavior.
- Retention policy, consent withdrawal, account deletion, audit, deletion retries, object counts/cost alerts and verified backups. R2 stores bytes; transcoding, thumbnails and AI processing need a separate worker pipeline.

## Remaining backend work and order
### Phase 0: access and contracts
Repair CLI auth, verify account/project IDs without exposing secrets, agree hosting/region and cost ceiling. Define identity migration, API contracts, wallet proof semantics, retention and threat model. Read current Git state before edits; existing preview screenshots are modified/untracked and must be preserved. Coordinate with UI contributor; own backend contracts/adapters rather than shared visual primitives.
### Phase 1: identity and safe staging
Firebase email/Google flow, verification/reset/recovery, UID mapping, refresh/revocation and suspension checks, role authorization, server-side rate limiting, abuse monitoring. Keep shared demo separate. Migrate existing users with verified recovery/relink or a reviewed supported password import; never assume hash compatibility. Acceptance: two users cannot access one another's studies/media, forged/expired/revoked tokens fail, roles cannot be escalated.
### Phase 2: evidence storage
R2 adapter, upload intents/multipart/finalization, authenticated playback and deletion jobs. Acceptance: real consented sample recorded/uploaded from Android, interrupted upload resumes, oversized/spoofed/duplicate/cross-account inputs rejected, seeking works, deletion completes, secrets never reach client/logs.
### Phase 3: wallet UX
Web connector plus existing Android adapter, linking/recovery and wallet-first login. Acceptance: real wallet + device verification; reject expired/replayed/wrong-domain/wrong-purpose signatures; same wallet cannot hijack another account; cancellation honest; login signature never triggers payment.
### Phase 4: production operations
Durable API hosting, DB migrations/backups with restore drill, jobs/outbox with retries and idempotency, health/readiness/alerts and redacted logs, staging/prod secrets, authorization audit, notifications and operational moderation. Update native API endpoint/config and enforce TLS, not development adb reverse. Load/race tests for budget, quota and evidence state.
### Phase 5: separate product gates
AI reports currently unavailable: add consent-aware transcription/analysis worker with timestamped evidence citations, retry/cost controls and review; never fabricated findings. Real compensation remains a separate decision: test-credit ledger is not funded money. Choose currency/rail and custody model, refunds/disputes/reconciliation and legal review before mainnet or actual payouts. Devnet success must be confirmed independently first. App signing/store distribution and physical-device tests are additional release gates.

## Verification and rollout
Use the existing full verification suite plus provider integration tests on isolated staging resources. Require independent security review, resolve all P0/P1/P2 findings, and preserve compatibility with merged UI. Roll out identity and storage behind explicit environment flags; do not unlock real-data uploads on shared demo accounts. Verify external resource state by readback, actual R2 object metadata/playback/deletion, and public browser/native flows before declaring production ready.

## Official references
- Firebase custom authentication: https://firebase.google.com/docs/auth/admin/create-custom-tokens
- R2 presigned URLs and capability semantics: https://developers.cloudflare.com/r2/api/s3/presigned-urls/

No implementation, provisioning, push or deployment occurred during this audit. Cloud account access and production hosting choice remain unresolved prerequisites.
