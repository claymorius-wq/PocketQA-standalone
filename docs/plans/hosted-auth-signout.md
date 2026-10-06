# Hosted auth: Google sign-in, sign-out, remaining hosted gaps (2026-10-06)

Hamza's request, relayed by the parent: an IMPLEMENT request, not plan-only.

- Google authentication doesn't work on https://pocketqa.vercel.app.
- Sign-out must work correctly for tester AND builder.
- Fix the remaining browser upload CORS, Google sign-in and pending hosted issues.
- Reproduce on the live UI with labelled QA accounts. Inspect console and network for the root cause.
- Write failing regression tests, then fix, deploy, and get independent QA (wX:p2).

## Constraints
- Preserve Hamza's migrated account and recording. Never impersonate him, never mark his email verified, never claim his playback happened.
- Google interactive login is completed by a human. No credential guessing.
- No admin promotion without an explicit target; role grants only via the trusted, audited server path.
- No deletion and no billing change.

## Findings (read-only, before any change)
1. **The Google provider is not configured.** Identity Toolkit admin v2 `defaultSupportedIdpConfigs` for `pocketqa-optijara` is `[]`; only email/password is enabled. The project subtype is `IDENTITY_PLATFORM`. Enabling Google needs an OAuth web client and consent screen. The Firebase console creates both when Google is switched on (Authentication → Sign-in method → Google → Enable, with a support email). There's no public API to create an OAuth client, so this step is Hamza's or the parent's.
2. **The CSP and COOP block the Google popup flow by design (ledger I9: Google was "not enabled").**
   - Firebase's `signInWithPopup` loads `https://apis.google.com/js/api.js` (blocked by `script-src 'self'`).
   - It also frames `https://<authDomain>/__/auth/iframe` (blocked: no `frame-src`, so `default-src 'self'` applies).
   - It talks to the popup through `window.opener`, which `Cross-Origin-Opener-Policy: same-origin` severs.

## Plan
1. **Google, client side.**
   - Allow exactly what the Firebase popup flow needs, and nothing broader: `script-src https://apis.google.com`, `frame-src https://<authDomain>`, `connect-src https://www.googleapis.com` if required, and COOP `same-origin-allow-popups`.
   - Do this only where Google sign-in is offered: the hosted CSP is built from the deployment's authDomain.
   - The production front door keeps its stricter policy until its own decision.
   - Map `auth/operation-not-allowed`, `auth/popup-blocked`, `auth/popup-closed-by-user` and `auth/unauthorized-domain` to plain messages: never a silent failure.
   - Tests: header/CSP tests and firebase-errors tests.
2. **Sign-out (tester and builder).** Reproduce live with two labelled synthetic accounts (one tester exists; one builder is to be created). Then check:
   - Firebase is signed out;
   - the API bearer is revoked (old ID token gets 401);
   - the query cache is cleared;
   - the role state is reset;
   - protected routes deny after logout, Back and reload;
   - switching tester ↔ builder shows no data from the other account;
   - only the app is signed out, never the Google account.

   Every defect found gets a failing regression test first.
3. **R2.** Live readback plus a preflight (`OPTIONS`) for the allowed origin vs a foreign one; a real browser-signed upload > 4.5 MB, private playback and cross-user denial. The upload, playback and denial already passed (`docs/verification.md`, QA post-run r2). The preflight matrix gets recorded.
4. **Deploy** with `build.mjs --deploy`, read back, and hand to QA. Google end-to-end needs the provider enabled (1) and a human Google login. Until then it's reported as blocked, not passed.
