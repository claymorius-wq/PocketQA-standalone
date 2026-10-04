# pqa-qa verdict: production increment 3 (wallet), r1 (security and product)

**Candidate:** the `git diff --cached` set in `.worktrees/production-readiness` (36 files, base `90a5ddd`), described in `inc3-candidate.md`. I reviewed it together with `docs/production/wallet-login-design.md`.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.
- I didn't rerun the native flows, because the emulator is shared; I inspected the artifacts instead.

## What I ran
- **`pnpm verify` with Node v24.21.0:** EXIT=0.
  - `check:secrets` scanned 603 files with no findings.
  - Script tests: 42.
  - Test counts: contracts 17, domain 170, API 360 passed plus 2 skipped, mobile 728.
  
  These match the candidate.
- **Playwright (`apps/mobile`):** **12/12**, PW_EXIT=0. It includes:
  - "wallet chooser: with two wallets installed, the user picks one; only that wallet signs, then it is disconnected";
  - the first-time and returning wallet sign-in tests.
  
  Playwright starts its own servers on 8899 and 8787 (`reuseExistingServer: false`). An unrelated Expo process from another project was on 8081, and I left it untouched. I restored the rewritten screenshots with `git restore docs/reviews/gate-a docs/reviews/remaining-scope`, and the worktree is clean apart from the staged set and my files.
- **Native artifacts I inspected** (emulator plus the Solana mock wallet):
  - `inc3-native/maestro.txt` reaches Discover after Approve, with `MAESTRO_EXIT=0`.
  - `mwa-login-2-siws.png` shows the exact server text: `pocketqa.local wants you to sign in…`, "…in the Pocket QA Android app… not a payment and sends nothing", URI `https://pocketqa.local`, `solana:devnet`, and a 5-minute expiry.
  - The decline run shows "declined or closed. You are not signed in." with Discover not visible, `MAESTRO_EXIT=0`.
  - A search for PIN-shaped input in `inc3-native*` found nothing.

## Verified as correct
- **The server binds each surface into the stored challenge.**
  - `mwa` uses the fixed `siwsDomain` and `appIdentityUri`. It isn't configurable, so it matches the app's declared identity.
  - `web` uses the public origin.
  - Verification rebuilds the stored text, so cross-surface signatures fail both ways (tested). An unknown surface gives 400.
  - Wallet login stays gated by `config.walletLogin`, admins are still refused, the rate limits are unchanged, and production still refuses `POCKETQA_WALLET_LOGIN=1` without A8.
- **Android:**
  - one `transact`: `authorize`, the challenge, `signMessages` over the exact text, then login;
  - no transaction API (unit test);
  - a decline never reaches `walletLogin`;
  - never offered in the preview build;
  - iOS throws honestly.
- **Web:**
  - Every login and link flow calls `standard:disconnect` in `finally`, including on decline.
  - Wallet Standard connections are per origin, so only Pocket QA's own connection is dropped.
  - The chooser keeps the picked wallet for the second "create account" signature (E2E).
  - Login uses `solana:signIn` only, never raw `signMessage`.
- **Error mapping can't produce a false signed-in or linked state.**
  - API errors keep their code: `NOT_FOUND` leads to "create account".
  - Linked state is shown only after `refreshUser()` from the server.
  - A decline says "You are not signed in" or "Nothing was linked".
- **The design doc matches the code** and names both residual risks.

## Findings (all P3, non-blocking for this local increment; they feed A8 and the production gate)

### P3-1: the MWA identity `https://pocketqa.local` can't be verified, and its icon is broken
- `.local` is not a real domain. The wallet shows a broken-image icon: `favicon.ico` relative to `pocketqa.local` can't resolve (`mwa-login-2-siws.png`).
- No wallet can ever check Digital Asset Links for it. That maximises the "self-asserted Android identity" residual.
- **Before production wallet login:**
  - Bind the `mwa` surface and the app identity to a domain Pocket QA owns. That could be the production origin, with an `assetlinks.json` for the release signing key (access action A6), and the icon served from it.
  - Until then, write into the design doc and Hamza's A8 sentence that `pocketqa.local` is a placeholder and the identity is unverifiable.

### P3-2: login can show transaction-wording errors
- `walletErrorText(e, 'sign-in')` maps codes `-2`/`-4` to "The wallet could not send the transaction (it may have no devnet SOL for fees). Nothing was sent."
- In MWA `signMessages`, `-2` means invalid payloads. Login never involves a transaction, so that text misleads.
- **Fix:** add sign-in-specific text, for example "The wallet couldn't sign the sign-in message. You are not signed in."

### P3-3: the MWA message drops the "only sign this on …" guidance
- The web statement says "Only sign this on <domain>"; the `mwa` statement doesn't.
- A phishing website that asks a raw-`signMessage` web wallet to sign the `mwa` text would show nothing telling the user not to sign it on a website. This is the cross-surface residual the design names.
- **Fix:** add "Only sign this in the Pocket QA Android app, never on a website." Make sure Hamza's A8 sentence explicitly covers both residuals: the self-asserted Android identity, and cross-surface raw `signMessage`.

### P3-4: untested paths stay open
These are honestly listed as not tested:
- **Android in firebase mode,** including the custom-token exchange on the device.
- **W5:** a real browser wallet.
- **W6:** a physical device with a real wallet.

## Gates still not run (kept open)
- **W4 and A8:** Hamza's risk acceptance.
- **W5 and W6:** real wallets and hardware.
- **Android firebase mode.**
- **Real Firebase:** access actions A1 and A2.
- **Backup and restore** (B3).

VERDICT: APPROVE
