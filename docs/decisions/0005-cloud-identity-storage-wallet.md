# 0005: Cloud identity (Firebase), private evidence storage (R2) and wallet login

**Status:** accepted for implementation, 2026-10-04. Branch `feat/cloud-auth-wallet`.
**Source plan:** `docs/plans/backend-cloud-auth-wallet-plan.md`.
**Authorized scope:** source code, config templates, emulator and local tests, docs, and a private PR.
**Not authorized:** creating cloud resources, billing, mainnet, payouts, or real uploads on the shared demo.

## Decisions

1. **Identity provider behind an interface** (`apps/api/src/identity/`).
   - The API keeps its own users, roles and statuses. Firebase only proves *who* is calling.
   - `POCKETQA_AUTH_MODE` is `local` (default; current password sessions, used by tests and the shared demo) or `firebase`.
   - In `firebase` mode:
     - every authenticated request carries a Firebase **ID token**, which is verified with revocation checking;
     - the token's UID resolves through `identities(provider, subject)` to the immutable internal user id;
     - roles come only from the server; custom claims are never trusted for authorization;
     - local password register and login are refused (one account system per deployment).
   - First sign-in: `POST /auth/identity/session` with a verified ID token.
     - It returns the mapped user.
     - With `{ role, displayName }` it creates the account. Roles are tester or builder only; admins stay offline-created.
     - Email/password identities must have a verified email.
     - Accounts are never auto-merged by email: if an existing account uses that email, the request is refused.
   - Logout in `firebase` mode is **global** (every device):
     - The server records `identities.valid_after_ms` and refuses ID tokens whose `auth_time` is at or before it. That takes effect at once and covers Firebase's one-second revocation granularity.
     - It also revokes Firebase refresh tokens, so no new ID tokens can be minted from old sign-ins, including refreshed ones.
     - A provider failure during logout is logged; the server-side revocation still applies.
     - Signing back in within the same second as logout can get 401 for up to a second, and the client retries.
   - Accepted sign-in providers: email/password and Google, each with a **verified** email. Other providers are refused until reviewed. Only those verified sign-ins count as a recovery method (`has_recovery`).
   - The shared demo is pinned to local auth and local storage by `scripts/preview/start.sh`. The process environment overrides `.env.local`, and the preview gate also blocks `POST /auth/identity/session`.
   - Suspension is enforced on every request from `users.status`, as today.
2. **Wallet-first login uses a separate challenge.**
   - It doesn't reuse the account-link nonce: `wallet_login_challenges` is a separate table, with a different statement, "Sign in to Pocket QA … not a payment".
   - The challenge is single-use and expires after 5 minutes. It is bound to address, domain, URI, chain, nonce and timestamps; the server rebuilds the exact message text.
   - It is rate-limited per address and per client, and consumed atomically whatever the outcome.
   - The verified wallet resolves to the account it's linked to. The only way to create an account is to ask explicitly with `newAccount: { role, displayName }`. A wallet already linked to another account can't be used to create or hijack one.
   - Response:
     - `local` mode: an API session token;
     - `firebase` mode: a Firebase **custom token** for the user's UID. The client exchanges it for an ID token, and custom tokens are never accepted as API bearer tokens.
   - The last sign-in method can't be removed: a wallet-only account can't unlink its wallet until it has another sign-in method (a password, or a Firebase identity from a non-custom provider).
3. **Evidence storage behind an interface** (`apps/api/src/storage/`).
   - `POCKETQA_STORAGE` is `local` (default; current filesystem behaviour) or `r2`.
   - In `r2` mode:
     - the tester creates an **upload intent**, with the same authorization, consent, state and quota checks as today, plus the bytes already reserved by open intents;
     - the server picks the opaque key `quarantine/<intentId>` and returns a short-lived presigned PUT, which is idempotent per `clientSegmentId`;
     - **complete**: the server checks the object's real size against the declared size and the limits, sniffs the container bytes against the declared type, and re-checks participation state and quotas in a transaction;
     - it then copies the object to the immutable `evidence/<evidenceId>`, records it, and deletes the quarantine object;
     - rejected uploads are deleted.
   - Playback keeps today's authenticated, permission-rechecked, `Range`-capable `/media/:token` stream, now read through the store. There are no direct public or long-lived URLs.
   - Deletions that fail are queued in `storage_deletions` and retried. Expired intents have their quarantine objects removed.
   - The shared demo can't run in `r2` mode: the config refuses `POCKETQA_SHARED_DEMO=1` together with `POCKETQA_STORAGE=r2`, and the preview gate still blocks uploads.
4. **Web wallet:** a Solana Wallet Standard connector (`link.web.ts`, `walletLogin.web.ts`) using `standard:connect` and `solana:signMessage` only. It never requests transaction signing.
   - Android keeps MWA.
   - iOS stays "unavailable": MWA isn't claimed for iOS, and iOS support is a separate research item.
5. **Client config is public:** `GET /config` returns `authMode`, `storage`, `walletLogin`, and Firebase *web* config (API key, auth domain, project id). Those are public identifiers, not secrets. Server credentials never leave the server.

## Threat model additions

| Threat | Control |
|---|---|
| Forged, expired or revoked ID token | Verified by the Firebase Admin SDK with `checkRevoked`. Tests cover forged, expired, revoked and wrong-audience tokens with the fake provider, and the real path runs against the Auth emulator. |
| Role escalation through claims | Roles live only in `users.role`. Admin can't self-serve. Claims are ignored. |
| Account takeover by matching email | No auto-merge. An email already used by a password account is refused. |
| Wallet login replay or cross-purpose replay | A separate challenge table; the purpose is in the statement; single use with atomic burn; expiry; domain, URI and chain bound; exact-message check. |
| Wallet hijack of another account | The wallet resolves only to its linked account. Creating an account with an already-linked wallet is impossible because the address column is unique. |
| Lockout by unlinking the last method | Refused unless another method exists. |
| Client-chosen object path, overwrite, spoofed size or type | The server generates keys. Final keys are immutable copies. The real size is checked by HEAD, and the bytes are sniffed. Quota covers reserved bytes. |
| A presigned URL leaks | It is short-lived and limited to one quarantine key, which is useless without completion by the owning tester. Playback never uses presigned URLs. |
| Secrets in the client or logs | Server-only environment variables. Config and log redaction tests. `check-secrets` and the repo-wide value scan. |

## Real-provider gates (not passed; need verified account access)

1. **Firebase:** a verified Optijara project id, an Admin service-account credential (`GOOGLE_APPLICATION_CREDENTIALS`, never in the repo), enabled email/password and Google providers, and authorized domains. Today `firebase projects:list` fails for the Optijara login.
2. **Cloudflare R2:** a verified Optijara account id, staging and production buckets with public access off, a bucket-scoped API token, and exact-origin CORS for PUT. Today `wrangler whoami` is unauthenticated.
3. **Hosting:** durable API hosting with TLS, and a managed database decision (ADR follow-up). Today it's a loopback Node API plus a tunnel.
4. **Real wallets:** a real Wallet Standard browser wallet, and an MWA wallet on a physical device.
