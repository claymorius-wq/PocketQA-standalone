# Wallet login per client surface: domain binding (design for increment 3, review before code)

## Problem
Today, wallet-first login challenges bind the SIWS `domain` and `uri` to `POCKETQA_PUBLIC_ORIGIN`. That suits a web wallet, because a `solana:signIn` wallet compares the domain with the page it's asked from.

Android Mobile Wallet Adapter (MWA) has no web page. The wallet sees only the dapp identity the app declares in `authorize` (`name`, `uri`, `icon`). Pocket QA already declares `appIdentityUri(DEFAULT_SIWS_DOMAIN)` for MWA linking.

## Design
1. `walletLoginChallenge` gains a required `surface: 'web' | 'android'`. The surface chooses the binding, and the server stores the exact `SiwsInput` with the challenge, as it does today:
   - **web:** `domain = host(POCKETQA_PUBLIC_ORIGIN)`, `uri = POCKETQA_PUBLIC_ORIGIN`. Unchanged.
   - **android:** `domain = DEFAULT_SIWS_DOMAIN`, `uri = appIdentityUri(DEFAULT_SIWS_DOMAIN)`, which is the identity the app declares to MWA. The statement says "in the Pocket QA Android app".
2. Verification is unchanged. `verifyWalletLogin` rebuilds the message from the **stored** input and requires a byte-for-byte match, plus the nonce, expiry, address and single use. A client can't choose a different domain after the challenge is issued.
3. The Android client runs **one MWA session**, as linking does:
   1. `authorize` returns the address.
   2. It requests a challenge with `surface: 'android'`.
   3. It calls `signMessages` with the exact server-built SIWS text.
   4. It posts `walletLogin`.
   
   The two-association `sign_in_payload` route didn't connect on the emulator's mock wallet; see `link.android.ts`.
4. Everything else is unchanged:
   - rate limits;
   - admins excluded;
   - in firebase mode, a custom token exchanged on the device and never used as a bearer;
   - a new account needs an explicit role choice.

## Residual risks (part of acceptance A8)
- **Android identity is self-asserted.** MWA doesn't verify the dapp identity unless the wallet checks Digital Asset Links. A malicious Android app could present itself as "Pocket QA" and get a signature over our Android-surface message, then submit it to sign in as the wallet owner. The mitigations are short expiry, single use, no payment ever, and admins excluded. The risk stays and must be in Hamza's acceptance sentence.
- **Cross-surface replay.** A web attacker could request an `android` challenge and ask a web wallet for a raw `signMessage` on it. A `solana:signIn` web wallet would flag the domain mismatch. Raw `signMessage` gives no domain check, which is the same residual already described in ADR 0005 §2. The web client never uses `signMessage` for login (`solana:signIn` only).
- **No WalletConnect.** It isn't used. MWA and Wallet Standard are separate paths, per CLAUDE.md.

## Tests planned
- Challenge per surface, comparing domain and uri with the stored input.
- A signature over the web message refused for an android challenge, and the reverse.
- An unknown surface refused.
- Production with wallet login off: the challenge is refused for both surfaces.
- The Android flow with a mocked `transact` (unit). Real-device MWA login is gate W6 (hardware).
