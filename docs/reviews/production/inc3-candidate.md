# Candidate: production increment 3 (wallet: web chooser, connect/disconnect, Android MWA login)

**Base:** `90a5ddd` (increment 2). The changes are uncommitted and frozen; the reviewable set is `git diff --cached`.

**Ledger rows:** W1, W2 and W3 (code and emulator). Still open:
- **W4:** production wallet login needs Hamza's recorded acceptance (A8). Production still refuses `POCKETQA_WALLET_LOGIN=1` without it.
- **W5 and W6:** a real browser wallet, and a physical device with a real wallet.

**Design:** `docs/production/wallet-login-design.md`, which you read in inc1. Please review it now together with the code.

## Changes

### API and contract
- `WalletLoginChallengeBody.surface?: 'web' | 'mwa'`, defaulting to `web`. These are the same values as the link nonce.
  - **`mwa`** binds `domain = siwsDomain` (`DEFAULT_SIWS_DOMAIN`) and `uri = appIdentityUri(domain)`, the identity the app declares to MWA. The statement reads "…in the Pocket QA Android app… not a payment and sends nothing".
  - **`web`** is unchanged: the public origin.
- Verification still rebuilds the **stored** input, so a signature made for one surface fails the other.
- Tests in `apps/api/test/wallet-login.test.ts`:
  - the MWA binding, and a full MWA login;
  - cross-surface signatures refused both ways;
  - an unknown surface gives 400.
- Contract log entry added.

### Web (`walletLogin.web.ts`, `link.web.ts`, `standard.ts`, `registry.web.ts`, `useWallets.ts`)
- **Chooser (W1).** `useWallets()` tracks Wallet Standard `register`/`unregister` events. Sign-in shows "Continue with <name>" per wallet, or one "Continue with wallet" when there's only one. Settings shows "Link <name>" per wallet. The chosen wallet is kept for the second "create account" signature.
- **No lingering connection.** Every web flow connects, asks for exactly one signature, and calls `standard:disconnect` in `finally`, including after a decline.
- Login sends `surface: 'web'` explicitly.

### Android (`walletLogin.android.ts`)
- One MWA `transact` session:
  1. `authorize` with the app identity;
  2. the `mwa` challenge;
  3. `signMessages` over the exact server text;
  4. `walletLogin`.
- No transaction APIs are ever called.
- The sign-in screen offers "Continue with wallet" on Android when the server enables wallet login. It is never shown in the preview build. iOS keeps a throwing stub with an honest message.
- `SessionProvider.signInWithWallet(newAccount?, wallet?)`:
  - API errors keep their code, so `NOT_FOUND` still leads to "create an account".
  - Wallet errors are mapped by `walletErrorText(e, 'sign-in')`, for example "declined or closed. You are not signed in."

## Evidence
- **`pnpm verify`:** EXIT=0.
  - Secrets scan: 600 files.
  - Test counts: scripts 42, contracts 17, domain 170, API 360 plus 2 skipped, mobile 728.
  - Output: `inc3-pnpm-verify.txt`.
- **Unit tests:**
  - `__tests__/wallet-mwa-login.test.ts`: the exact text is signed, no transaction APIs are used, and a declined signature never reaches login.
  - `__tests__/wallet-web-flows.test.ts`: `surface: 'web'`, disconnect on success and on decline, and the chosen wallet only.
- **Playwright:** 12/12, `PW_EXIT=0`. The new **two-wallet chooser** test checks that:
  - only the picked wallet signs, twice;
  - the other wallet is never asked;
  - the picked wallet is disconnected twice;
  - Settings shows that address;
  - unlink on a wallet-only account is refused with an error and the link is kept.
  
  The rewritten screenshots were restored.
- **Firebase emulator E2E:** 4/4.
- **Native, EMULATOR ONLY** (AVD `Medium_Phone_API_36.1`; Solana Mobile **mock** wallet `com.solana.mwallet`; local API with `POCKETQA_WALLET_LOGIN=1`).
  - APK sha256: `d061f40d8cf3a14195baa6d10490937f9cfab25538a1b6548dc9dffbfa3fb8f2`.
  - **`wallet-login-mwa.yaml`: MAESTRO_EXIT=0.** The flow: Connect → the wallet shows "pocketqa.local wants you to sign in… Sign in to Pocket QA in the Pocket QA Android app… not a payment and sends nothing", with URI `https://pocketqa.local` and devnet (screenshot `mwa-login-2-siws.png`) → Approve → no account → create → a second MWA session → Discover.
  - **`wallet-login-mwa-decline.yaml`: MAESTRO_EXIT=0.** Cancel shows "declined or closed. You are not signed in.", and Discover is not shown.
  - The test AVD PIN was passed through an environment variable and redacted from Maestro's commands JSON. A scan found 0 occurrences in `docs/reviews/production`.
- **Not tested:**
  - a real browser wallet extension (W5);
  - a physical device with a real wallet (W6);
  - firebase mode on Android with the custom-token exchange (the web E2E covers it on web).

## Review asks
- **The domain-binding design and its residual risks** (self-asserted MWA identity; cross-surface raw `signMessage`). Are these acceptable for A8's wording?
- **Error mapping.** Can anything be read as signed in when it isn't, or as linked when it isn't?
- **Disconnect semantics.** Do we disconnect from wallets the user had connected for other sites? Wallet Standard connections are per origin, so we only disconnect our own.

## r1 follow-ups (`inc3-verdict-qa-r1` APPROVE, all P3)
- **P3-2.** Sign-in maps MWA `-2`/`-4` to "The wallet couldn't sign the sign-in message. You are not signed in.", never transaction wording. Covered by a unit test.
- **P3-3.** The `mwa` statement now adds "Only sign this in the Pocket QA Android app, never on a website." Covered by the API test, and by an emulator re-run where the wallet shows it (`inc3-native/`, MAESTRO_EXIT=0, PIN redacted).
- **P3-1.** `pocketqa.local` is recorded as an unverifiable placeholder identity, in the design doc and the ledger. Moving it to an owned domain with `assetlinks.json` is a precondition for W4 and W6. The A8 wording now has to cover both residuals.
- **P3-4.** The untested paths are recorded in the ledger.
