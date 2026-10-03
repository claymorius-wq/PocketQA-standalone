# pqa-qa verdict, cloud increment 4, round 2 (verbatim pane output; frozen tree 12afcc3f)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env.local or credential files. Both r1 P2s and all five P3s are fixed, the theme-test change is a
  legitimate correction, and nothing regressed. Three new P3s remain.

  Round-1 findings

  1. [P2] Web wallet linking on the shared demo — FIXED on both the server and the client.
     - The gate now refuses POST /wallet/(nonce|link), DELETE /wallet and POST /devnet/transfers (with or without
       /:id/signature), all with plain messages (gate-server.mjs:67-70). They go through the same path checks as
       before.
     - walletCapability('web') reports unavailable in PREVIEW_BUILD ("not available in the shared preview",
       capability.ts:29-34).
  2. [P2] False "data stays on this machine" — FIXED. signInFooter now builds the text from /config (footer.ts:7-13).
     The local-only wording appears only for local auth plus local storage, and the Firebase browser test asserts the
     firebase-mode footer. A remaining edge case is new finding 1.
  3. [P3] Offline start signing users out — FIXED. Only a definite UNAUTHENTICATED clears the session
     (SessionProvider.tsx:101).
  4. [P3] Expired ID token signing users out — FIXED.
     - On a 401, the client refreshes once with getIdToken(true) and retries (client.ts:67-73,
       SessionProvider.tsx:84-92).
     - The retry applies only to the session's own token, not to explicit tokens or FormData bodies, and only once.
     - A token revoked at logout still ends the session: the refreshed token keeps the old auth_time, or the refresh
       itself fails.
  5. [P3] Persistence — FIXED. Web Firebase uses browserSessionPersistence, documented in ADR 0005 §1 and the deploy
     doc.
  6. [P3] Domain warnings when linking on the web — FIXED.
     - walletNonce with surface: 'web' binds the link message's domain and URI to POCKETQA_PUBLIC_ORIGIN, and returns
       409 if no origin is set (wallet.ts:103-112).
     - Android: MWA linking keeps the fixed identity domain by default (test wallet-link-origin.test.ts:33-38), so it
       doesn't regress.
     - Origin config: POCKETQA_PUBLIC_ORIGIN is optional but validated when set, and still required for wallet login
       (config.ts:112-126).
     - Cross-purpose: link and login stay non-interchangeable (separate tables and statements). A phishing page asking
       for a web link signature now triggers the wallet's domain warning.
     - Evidence: the new Playwright test with a Phantom-like, domain-checking wallet passes, and the candidate reports
       a mutation check showing it fails without the binding.
  7. [P3] Smaller items — FIXED or carried.
     - Firebase sign-in errors are now generic (firebaseErrors.ts), with no account-existence leak.
     - The role and name from sign-up carry over into "Finish your account".
     - The API CORS note is in the deploy doc.
     - The multi-wallet chooser is carried as documented.

  Theme test: a legitimate correction, not a weakened check (review-loop.spec.ts:181-210)
  - The old assertion expected rgb(13, 13, 15) on the settings screen element itself. That's the pre-Lens dark ground.
    The Lens UI paints the background on an ancestor and leaves the screen transparent, which is why it failed on clean
    origin/main (baseline file).
  - The new test walks to the nearest non-transparent ancestor and asserts the actual token values:
    - light.background #F6F6F4 = rgb(246, 246, 244);
    - dark.background #0B0A1F = rgb(11, 10, 31) (tokens.ts:51, :88).
  - It now also checks the light ground before switching, keeps the check that dark persists after a reload, and uses
    exact equality.
  - It's stricter than before, not looser. Playwright passes 11/11.

  Regression check
  - Android MWA linking is unchanged.
  - Local mode is unchanged: no refresher is configured there.
  - The shared-demo blocks (uploads, register, identity, wallet login, linking, transfers, moderation) all hold.
  - The custom-token-is-never-a-bearer rule and the storage PUT without a bearer are intact.
  - Evidence: pnpm verify EXIT=0, Firebase end-to-end 2/2, emulator 2/2 with no tokens in the log.

  New findings (P3, non-blocking)

  1. [P3] The footer's local wording can still be wrong for a remotely hosted API. footer.ts:9: a deployment with local
     auth and local storage whose API runs on a remote server would still say "data stays on this machine".
     - Fix: Also require that API_BASE_URL is loopback (127.0.0.1/localhost). Otherwise say "Accounts and evidence are
       kept on the Pocket QA server".
  2. [P3] Google sign-in errors are mislabelled. firebaseErrors.ts:16: every other auth/* code on sign-in maps to
     "Email or password is incorrect", including Google popup failures such as auth/unauthorized-domain and
     auth/account-exists-with-different-credential. That misleads Google users and hides configuration errors.
     - Fix: Map the Google and popup codes separately (for example "Google sign-in isn't available on this site" or
       "This email already uses another sign-in method"), and keep the generic text for password sign-in only.
  3. [P3] The theme test hard-codes the RGB values. review-loop.spec.ts:184-185 duplicates the palette values, so a
     future token change fails with a confusing mismatch.
     - Fix: Import light.background and dark.background from src/theme/tokens.ts and convert hex to rgb(...) in the
       test.

  VERDICT: APPROVE
