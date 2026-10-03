# Freeze candidate: cloud backend increment 2, wallet-first login (API)

**Worktree:** `/Users/hamzadiaz/Projects/pocket-qa/.worktrees/cloud-auth-wallet`. **Branch:** `feat/cloud-auth-wallet`.
**Base:** increment 1, committed as `f655d8f` (r2 APPROVE). This increment's changes are staged on top.
**Scope:** ADR 0005 §2, plan Phase 3 (API side). The web and Android client connectors come in a later increment.

## Changes
- **Contracts:**
  - `WalletLoginChallengeBody`, `WalletLoginBody` (link body plus optional `newAccount` with a tester/builder role);
  - `WalletLoginSession`: `local` token or `firebase_custom_token`;
  - `WalletLoginResponse`;
  - routes `POST /auth/wallet/challenge` and `POST /auth/wallet/login`, both public, since they prove control of a key instead of a session;
  - the contract test's guard on public routes is updated deliberately.
- **Domain:**
  - `verifyWalletLogin`: no account binding; checks unknown, used, expired, nonce, record address vs signed-input address, exact message and signature;
  - the shared `verifySignedSiws` is factored out of `verifyWalletLink`, whose 9 existing tests still pass.
- **DB migration 2:** a separate table `wallet_login_challenges`, so link nonces and login challenges can't be swapped.
- **Config:** `POCKETQA_WALLET_LOGIN=1` is opt-in and refused with `POCKETQA_SHARED_DEMO=1`, because wallet login creates accounts.
- **`apps/api/src/handlers/walletLogin.ts`:**
  - **Challenge:** its own statement ("Sign in to Pocket QA … not a payment and sends nothing"), devnet chain, 5-minute expiry; rate-limited to 5/min per address and 30/min per client (`rateLimit.ts`, in-memory per process); expired rows are pruned.
  - **Login:** in one transaction it burns the challenge whatever the outcome, verifies it, and resolves the address to the linked, non-deleted account.
    - If the wallet is linked, that account signs in and `newAccount` is ignored, so there's no hijack.
    - If not, `newAccount` creates a wallet-only account (`wallet-<id>@wallet.pocketqa.invalid`, no password) plus its link.
    - Without `newAccount`, it returns 404 (the challenge stays burnt).
  - **Session:**
    - local mode: an API session;
    - firebase mode: a custom token for the account's existing Firebase UID (for example its Google UID), or a new `identities(firebase, <userId>)` row with `has_recovery=0`.
- **`walletUnlink`:** refused (409) unless the account has a password or a recovery identity (`has_recovery=1`, meaning a verified email or Google sign-in).
- **`GET /config`:** reports `walletLogin`.
- **Shared demo:** `start.sh` also pins `POCKETQA_WALLET_LOGIN=0`, and the gate blocks `/auth/wallet/(challenge|login)`.

## Evidence
- **Red first:** `test/wallet-login.test.ts` failed 11 tests before the implementation.
- **API tests** (11):
  - create only on request; the returning user gets the same account; `newAccount` is ignored when the wallet is linked;
  - the statement says "not a payment";
  - replay, tampered message, wrong key and wrong address all fail, with the challenge burnt;
  - expiry;
  - link nonces and login challenges aren't interchangeable;
  - a wallet linked to an existing account signs in only to it;
  - a wallet-only account can't unlink;
  - the per-address rate limit;
  - off unless enabled;
  - firebase mode: the custom token isn't a bearer, the exchanged ID token works, and an email account's linked wallet uses that account's UID while allowing unlink.
- **Domain:** `verifyWalletLogin` has 2 tests, including that a link-statement signature is refused.
- **Config:** wallet login is opt-in and refused with the shared demo.
- **Preview:** the `start.sh` pin test and the gate block test ran red, then green.
- **Mutations**, each caught:
  - W1: burn only on success;
  - W2: `newAccount` honoured for a linked wallet;
  - W3: not gated by config;
  - W4: no rate limit;
  - W5: last method can be unlinked.
- **`pnpm verify`:** EXIT=0 (`inc2-pnpm-verify.txt`): API 305 plus 2 emulator-only, domain 170, mobile 674, root 37.

## Known limits (documented, not blockers)
- The rate limit is per process; multi-instance hosting needs a shared store (a hosting gate).
- `req.ip` is the direct peer because `trustProxy` is false. Behind a proxy, every client shares one key, so the per-client limit becomes global. Hosting must configure trusted proxies (deployment doc).
- There's no account-merge flow: a wallet already linked elsewhere can't be attached to another account (refused, as before).

## Review r1 fixes (`inc2-verdict-qa-r1.md`: CHANGES_REQUIRED, 1×P2 and 3×P3)
- **P2: phishable login with a domain no wallet can check.**
  - Challenges now carry the deployment's real origin: `POCKETQA_PUBLIC_ORIGIN` is required when wallet login is on and validated as an exact https origin (http only for localhost; no path, credentials or wildcard). Its host is the SIWS `domain`, the origin is the `uri`, and the statement says "Sign in to Pocket QA at <origin> … Only sign this on <host>".
  - The web client must use Wallet Standard `solana:signIn` (wallet-side domain check), arriving in increment 4. Android wallet login isn't offered.
  - The server's exact-message check refuses a signature over any other domain (tested with a "phishing origin" message).
  - The residual raw-`signMessage` risk is documented in ADR 0005 §2, and wallet login stays **off by default**.
  - Tests: the origin binding and phishing-domain refusal, plus config validation of the origin (7 cases).
- **P3: lockout through the per-address limit.** It is now keyed by address *and* client, with the per-client cap kept. Test: an attacker client at its limit doesn't block the owner's client.
- **P3: identity row outside the transaction.** The Firebase subject is selected or inserted inside the login transaction, and `createCustomToken` runs afterwards.
- **P3: admin wallet login.** Refused (403); admins sign in with email or Google. Test added.
- **Mutations:** W6 (fixed link domain instead of the origin), W7 (admin wallet login allowed) and W8 (address-only limiter) are each caught.
- **`pnpm verify`:** EXIT=0 (`inc2-pnpm-verify.txt`).

## After r2 APPROVE (disclosure and P3s)
- **Disclosure:** the r2 frozen tree (`59b0669f`) did **not** pass `pnpm verify`. Lint flagged a useless initial assignment (`let u: URL | null = null`) in the origin validation, and the reviewer's note "EXIT=0" was mistaken. The fix (`let u: URL | null;`) has no behaviour change. `pnpm verify` is now EXIT=0 (API 307 plus 2 emulator-only).
- **r2 P3 #1:** ADR §4 now says login uses `solana:signIn` only, with no fallback to `signMessage`; `signMessage` is for account linking only.
- **r2 P3 #2:** the ADR now says Hamza's explicit acceptance of the residual risk is **not yet recorded** and is required before wallet login is enabled anywhere but localhost.
- **r2 P3 #3:** carried into increment 4 as acceptance items:
  - client tests assert `solana:signIn` with the server's challenge fields and never `signMessage`;
  - a wallet without signIn gets an honest "not supported" message;
  - a real-wallet origin test is run.
