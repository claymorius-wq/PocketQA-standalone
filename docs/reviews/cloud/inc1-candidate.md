# Freeze candidate: cloud backend increment 1, managed identity (Firebase)

**Worktree:** `/Users/hamzadiaz/Projects/pocket-qa/.worktrees/cloud-auth-wallet`. **Branch:** `feat/cloud-auth-wallet`, staged and not committed. **Base:** `origin/main` `1b8385c`, including the collaborator's Lens UI.
**Author:** lead (solo, claude-opus-5-5). **Reviewer:** `pqa-qa` (read-only).
**Scope:** `docs/decisions/0005-cloud-identity-storage-wallet.md` §1, and the plan `docs/plans/backend-cloud-auth-wallet-plan.md` Phase 1.

## Changes
- **Contracts v0.4.0** (additive):
  - `ClientConfig` (public, via `GET /config`), `IdentitySessionBody/Response`;
  - a route auth kind `identity` (a verified provider identity that may not have an account yet);
  - error code `EMAIL_UNVERIFIED`.
- **Config** (`apps/api/src/config.ts`):
  - `POCKETQA_AUTH_MODE=local|firebase`; Firebase project id and public web key are required in firebase mode;
  - the emulator host is allowed only for `demo-` projects on loopback;
  - a raw `FIREBASE_AUTH_EMULATOR_HOST` is refused outside that setup, because firebase-admin would otherwise accept unsigned tokens;
  - `POCKETQA_SHARED_DEMO=1` is refused with firebase mode.
- **Identity:** `apps/api/src/identity/types.ts` (interface plus `IdentityError`) and `firebase.ts` (Admin SDK adapter).
  - Token-invalid codes give 401; other errors propagate.
  - Credentials come only from the environment.
- **DB migration 1:** `identities(provider, subject, user_id, has_recovery, valid_after_ms)`.
- **`app.ts` `authenticate()` (now async):**
  - firebase mode: verified ID token (`checkRevoked`), UID mapped to a non-deleted user, plus a server-side `valid_after_ms` check;
  - local password sessions are **not** accepted in firebase mode;
  - the `identity` auth kind;
  - suspension and roles from the server only.
- **Handlers** (`account.ts`):
  - `clientConfig`;
  - `identitySession`: maps the UID, or creates an account only with an explicit tester/builder `newAccount`; requires a verified email for password identities; never merges by email; refuses custom-token identities;
  - register/login refused in firebase mode;
  - logout sets `valid_after_ms` and revokes provider refresh tokens;
  - deleteMe removes identity mappings in the transaction, then revokes and deletes the provider user after commit (failures are logged, and the orphan can't reach the account).
- **Tests:**
  - `test/fakeIdentity.ts`: deterministic HMAC tokens with audience, expiry and Firebase-faithful second-granularity revocation;
  - `test/identity.test.ts` (11 tests), `test/identity-config.test.ts` (5);
  - `test/firebase-emulator.test.ts`: the real adapter against the Auth emulator, via `pnpm test:emulator` and `firebase.json`.

## Evidence
- **Red first:** `identity.test.ts` had 11 failing tests before the implementation.
- **Found by the emulator:** Firebase revocation has one-second granularity, so a token from a sign-in in the same second as logout survived revocation (the emulator test got 200 where 401 was expected). After the fake was made faithful to that, the unit test went red too. The fix is a server-side `valid_after_ms`, and both now pass.
- **`pnpm verify`:** EXIT=0 (`inc1-pnpm-verify.txt`). API 289 passed, plus 2 emulator tests that skip without an emulator; mobile 674; contracts 14; domain 168; root 36.
- **`pnpm test:emulator`:** 2/2 passed (`inc1-firebase-emulator.txt`), on the `demo-pocketqa` project with no account or network. The log has no tokens.
- **Mutations:** I1 (no server-side revocation), I2 (unverified email accepted), I4 (local sessions accepted in firebase mode), I5 (emulator allowed for a real project) and I6 (raw emulator env ignored) are each caught. I3 (dropping the explicit email-merge check) is equivalent: the `users.email` UNIQUE constraint still refuses the insert with 409.
- **Scanner:** placeholder web-config values in tests carry `check-secrets: allow` with a reason; the scan is clean.

## Real-provider gates (not passed)
- A Firebase project for Optijara isn't verified (`projects:list` fails), and there's no Admin credential.
- No real email/Google sign-in has been tested; only the emulator.

## Review r1 fixes (`inc1-verdict-qa-r1.md`: CHANGES_REQUIRED, 1×P2 and 5×P3)
- **P2: shared demo not pinned.** `scripts/preview/start.sh` now sets `POCKETQA_SHARED_DEMO=1 POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local` on the API command (the process environment beats `.env.local`). The preview gate also blocks `POST /auth/identity/session`. Tests: a scripts test checks the API command line, and the gate block list includes the route. Both ran red, then green.
- **P3: has_recovery.** It is set only for a verified sign-in through an allow-listed provider (`isRecoverableSignIn`: password or Google, with a verified email).
- **P3: provider allow-list.** A verified email is required for **every** provider, and only password and Google are accepted (others get 403). Test red, then green.
- **P3: logout.** Playback tokens are deleted before the provider call, and a provider failure is logged, not surfaced (server-side revocation already applies). Test red, then green.
- **P3: docs.** ADR 0005 §1 documents global logout, the same-second retry, accepted providers and the preview pinning.
- **P3: fake.** It now has a separate `auth_time`, and `refresh()` keeps the original auth_time. A new test checks that a token refreshed after logout from a pre-logout sign-in is refused.

**Evidence:** `pnpm verify` EXIT=0 (API 292 plus 2 emulator-only; root 37). `pnpm test:emulator` 2/2.

## After r2 APPROVE (P3s applied as suggested)
- Test variant with a no-op provider revocation: a refreshed pre-logout token is still refused by the server-side `valid_after_ms` (the mutation removing it fails 3 tests).
- Dedicated error code `PROVIDER_UNSUPPORTED` (403) for unsupported sign-in providers.
- r2 P3 #2 (parse `POCKETQA_STORAGE`, refuse r2 with the shared demo) is scheduled for increment 2.
