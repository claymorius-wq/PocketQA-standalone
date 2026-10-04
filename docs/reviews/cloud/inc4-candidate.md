# Freeze candidate: cloud backend increment 4, clients (Firebase, web wallet) and deployment docs

**Worktree:** `/Users/hamzadiaz/Projects/pocket-qa/.worktrees/cloud-auth-wallet`. **Branch:** `feat/cloud-auth-wallet`.
**Base:** increments 1–3 are committed (`f655d8f`, `1d8d9dd`, `fe0d91d`); this increment is staged on top.
**Scope:** ADR 0005 §1 and §4 (client side), the increment-2 r2 acceptance conditions for web wallet login, and the environment and deployment docs.

## Changes
- **Web wallet** (`apps/mobile/src/wallet/`):
  - `standard.ts`: Wallet Standard helpers with structural types.
    - Discovery lists only devnet wallets that can connect.
    - `signInWithWallet` uses `solana:signIn` with the server challenge **only**. A wallet without it throws `WalletUnsupported` ("doesn't support Sign In With Solana"); there's no `signMessage` fallback, and an account mismatch is refused.
    - `signMessageWithWallet` is for linking only.
  - `registry.web.ts` (`@wallet-standard/app`), plus `registry.ts` for native (empty).
  - `walletLogin.web.ts`: connect, challenge, `solana:signIn`, `walletLogin`. `walletLogin.ts` (Android/iOS) refuses honestly; Android wallet login isn't offered, per the ADR.
  - `link.web.ts`: Wallet Standard linking by `signMessage` over the server's exact link text, keeping the shared `linkWalletWithMwa` export name.
- **Capabilities:**
  - `walletCapability('web')` is available only when a Wallet Standard wallet is installed;
  - a new `transferSignCapability`: devnet transfer signing stays Android/MWA only, so `TransferCard` never offers signing on web.
- **Firebase client** (`src/auth/firebaseClient.ts`): configured only from the server's public `/config`, with the emulator only when the server says so. It covers email sign-in, sign-up with a verification email, Google popup (web), the custom-token exchange and the ID-token listener.
- **Session** (`SessionProvider.tsx`, `managedSession.ts`):
  - local mode is unchanged;
  - firebase mode: the bearer is the latest ID token from the SDK listener; after any sign-in the identity is resolved (mapped user, `needsAccount`, or an actionable "verify your email");
  - `completeAccount` (explicit role);
  - `signInWithWallet`: a local session, or the custom token exchanged through Firebase and never used as a bearer;
  - a 401 also signs Firebase out.
- **UI** (minimal, existing kit only, preserving the Lens design):
  - "Continue with Google" appears in firebase mode on web;
  - "Continue with wallet" appears when wallet login is enabled and a Wallet Standard wallet is installed;
  - a "Finish your account" card covers a managed identity with no account, and also the first wallet login ("Create an account with this wallet", which takes a second, fresh signature);
  - sign-up shows "Check your email" in firebase mode.
- **API (small):** `identitySession` now checks the identity (custom, verified email, provider) **before** reporting "no account yet", so an unverified sign-in hears "verify your email" (found by the Firebase browser test). An API test was added.
- **Contracts test:** `buildSiwsMessage` is byte-identical to Wallet Standard `createSignInMessageText`, because the server's exact-match check depends on it.
- **Docs:** `docs/deploy/cloud-backend.md` covers the flags, Firebase and R2 setup gates, hosting notes, wallet-login enabling conditions and local verification commands; `.env.example` has the new variables with no values.
- **Tests and config:** `playwright.config.ts` enables wallet login bound to `http://localhost:8090`; the Firebase browser tests have their own config, `playwright.firebase.config.ts` and `e2e-firebase/`, excluded from Jest; root scripts `test:e2e:firebase` and `test:emulator`.

## Evidence
- **Jest**, red then green:
  - `wallet-standard.test.ts` (5): signIn with exactly the challenge and never signMessage; refusal without signIn; account mismatch refused; discovery; link signing.
  - `wallet-web-flows.test.ts` (3): the API call sequence and bodies; `newAccount` only on request; linking signs the exact server text.
  - `managed-session.test.ts` (4).
  - `capability.test.ts`: web wallet capability; transfer signing is Android only.
- **`pnpm verify`:** EXIT=0 (`inc4-pnpm-verify.txt`): contracts 15, domain 170, API 334 plus 2 emulator-only, mobile 698, root 37.
- **Playwright** (`inc4-playwright.txt`): 9 passed, 1 failed.
  - New `e2e/wallet-login.spec.ts`, 2 tests against the real API with a test Wallet Standard wallet that builds the SIWS text with the standard formatter and checks the domain:
    - first login: no account, so "Create an account with this wallet", then two `solana:signIn` calls with fresh nonces bound to `localhost:8090`, then into the app;
    - returning wallet in a fresh browser context: one signature, straight in;
    - `signMessage` is never called;
    - a wallet without signIn gets the honest refusal.
  - **The 1 failure is pre-existing on `origin/main`:** the theme-switch test expects an opaque settings background, but the Lens glass UI makes it transparent. It fails identically on a clean `origin/main` worktree (`inc4-theme-test-baseline-origin-main.txt`). Left for the UI contributor.
- **`pnpm test:e2e:firebase`** (`inc4-playwright-firebase.txt`), 2/2 against the Firebase Auth emulator and the real API in firebase mode:
  - sign-up shows "Check your email";
  - an unverified sign-in shows "Verify your email";
  - verification through the emulator's link, then sign-in, "Finish your account", and into the app;
  - a reload keeps the session;
  - the API refuses local password login in firebase mode.
- **`pnpm test:emulator`:** API ↔ Firebase Admin 2/2 (unchanged from increment 1).

## Gates and limits
- **Not tested** (named in the deploy doc):
  - Google sign-in, which needs a real project and domain;
  - a real Wallet Standard browser wallet;
  - native Android or iOS in firebase mode (the Firebase JS SDK on React Native without persistence setup is not production-ready);
  - real R2 uploads from a device.
- Hamza's acceptance of the wallet-login residual risk is still not recorded, so wallet login stays off by default.

## Review r1 fixes (`inc4-verdict-qa-r1.md`: CHANGES_REQUIRED, 2×P2 and 5×P3)
- **P2: web wallet linking reached the shared demo.** Fixed on the server **and** in the UI.
  - The preview gate now refuses `POST /wallet/(nonce|link)`, `DELETE /wallet`, `POST /devnet/transfers` and `POST /devnet/transfers/:id/signature` (gate test red, then green).
  - `walletCapability('web')` is unavailable when `PREVIEW_BUILD`, with "not available in the shared preview" (capability test red, then green).
- **P2: false "data stays on this machine" on cloud deployments.** The footer now comes from `/config` (`src/auth/footer.ts`):
  - "Local build · data stays on this machine" only for local auth plus local storage;
  - otherwise "Sign-in is managed by Firebase / Accounts are kept on the Pocket QA server · evidence is stored privately in cloud storage / on the Pocket QA server";
  - the preview text is unchanged.
  - `footer.test.ts` ran red, then green, and the Firebase browser test asserts the firebase-mode footer.
- **P3: offline start signed users out.** Only a definite `UNAUTHENTICATED` clears the session.
- **P3: expired ID token signed users out.** `configureClient` has a `refreshToken` (firebase mode: `getIdToken(true)`); a 401 refreshes once and retries before signing out. Local mode is unchanged. `token-refresh.test.ts` ran red, then green.
- **P3: persistence.** Web Firebase uses `browserSessionPersistence` (tab-scoped, like local mode's sessionStorage), documented in ADR 0005 §1 and the deploy doc.
- **P3: SIWS domain warnings when linking on the web (origin binding).** `walletNonce` accepts `surface: 'web'`, which binds the link message's domain and URI to `POCKETQA_PUBLIC_ORIGIN`; it is refused (409) if no origin is configured. MWA keeps the fixed identity domain. `POCKETQA_PUBLIC_ORIGIN` is now optional (validated when set) and still required for wallet login.
  - API tests: `wallet-link-origin.test.ts` (3, red then green).
  - Client: `link.web.ts` sends `surface: 'web'`, asserted in the test.
  - New Playwright test: a Phantom-like wallet that checks SIWS domains in `signMessage` links successfully. Without the origin binding, the same test fails (mutation checked, then restored).
- **P3 smaller items:**
  - Firebase errors are mapped to generic text (`src/auth/firebaseErrors.ts`, test), so sign-in never reveals whether an account exists;
  - the role and name from sign-up are carried into "Finish your account" (the Firebase browser test asserts the prefill);
  - the API CORS note for hosting is in the deploy doc.
  - **Carried, documented:** a chooser when several wallets are installed.
- **Lint:** the mapped errors keep their `cause`.
- **Pre-existing theme test** (fails on clean `origin/main` because of the Lens glass UI): resolved **test-only**, with no UI change.
  - A probe showed the theme works. The effective ground (nearest non-transparent ancestor) is `light.background` `#F6F6F4`, then `dark.background` `#0B0A1F` after switching, and it persists across a reload.
  - The test now asserts the effective background against those token values, and it now also checks the light ground before switching.
  - Reviewer: please validate that this is a legitimate correction and not a weakened check.

**Evidence (this tree):**
- `pnpm verify` EXIT=0: contracts 15, domain 170, API 337 plus 2 emulator-only, mobile 706, root 37.
- Playwright **11/11** (`inc4-playwright.txt`).
- `pnpm test:e2e:firebase` 2/2.
- `pnpm test:emulator` 2/2 (`inc4-firebase-emulator.txt`, no tokens in the log).

## After r2 APPROVE (r2 P3s applied)
- The footer's local-only wording now also requires a loopback API (`isLoopbackApi`); a hosted API gets "Accounts and evidence are kept on the Pocket QA server". A test was added.
- Google and popup sign-in errors have their own messages (unauthorized domain, account exists with a different method, popup blocked) instead of "Email or password is incorrect". A test was added.
- r2 P3 #3 (importing token values in the theme test) is not applicable: `tokens.ts` imports `react-native`, which the Node-based Playwright runner cannot load. The values are pinned, and the comment references `light.background` and `dark.background`.
- Final tree: `pnpm verify` EXIT=0 (mobile 709), Playwright 11/11, Firebase browser tests 2/2.
