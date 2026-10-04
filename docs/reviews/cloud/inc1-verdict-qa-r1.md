# pqa-qa security verdict, cloud increment 1, round 1 (verbatim pane output; frozen tree a22a6f62)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env* or credential files. The identity core is sound, but one P2 blocks: the shared-demo guard the ADR
  relies on is never switched on by the preview launcher.

  What holds up
  - Token checks:
    - In firebase mode, every bearer goes through verifyIdToken(token, true), which checks signature, audience, issuer,
      expiry and revocation (identity/firebase.ts:35).
    - Only client-caused token errors map to 401 (:8-15); provider outages propagate as 500 (app.ts:100-102).
    - A custom token fails verification and gets 401, tested both with the fake and on the emulator
      (firebase-emulator.test.ts:76-84).
  - Local sessions don't count in firebase mode: they're never consulted (app.ts:95-118), local register and login get
    409 (account.ts:41-45), and the identity route is off in local mode (app.ts:138).
  - Roles stay on the server: a role comes only from users.role, self-serve accounts can only be tester or builder
    (contract :482-484), and admin-looking claims are ignored (test identity.test.ts:50-56).
  - No email auto-merge: an existing email gets 409 (account.ts:99-101).
  - Unverified email: blocked for password sign-ins, and the emulator run confirms it.
  - Isolation between users: the 404 rule is unchanged, and the test at :109-123 confirms two users can't see each
    other's studies.
  - Revocation: provider revocation, plus a server-side valid_after_ms for Firebase's one-second granularity. The
    emulator found that gap, and the candidate fixed it test-first.
  - Emulator guards: the emulator is allowed only with a demo- project on loopback, and a stray
    FIREBASE_AUTH_EMULATOR_HOST is refused at startup (config.ts:83-92, tests identity-config.test.ts:21-30).
  - Deletion: identity mappings are removed inside the transaction; the provider revoke and delete run after commit,
    and failures are logged without reaching the old account.
  - Client config: exposes only public web settings.
  - Evidence: pnpm verify EXIT=0 with secrets 480 files clean, and the emulator run passes 2/2 with no tokens in the
    log.

  Findings

  1. [P2] The shared-demo guard is never switched on, so the preview can pick up Firebase or later R2 settings from
     .env.local. scripts/preview/start.sh:27-28, apps/api/src/config.ts:93-94, server.ts:9
     - The isolation control (POCKETQA_SHARED_DEMO=1 refuses firebase, and per ADR 0005 §3 also r2) only works if the
       flag is set. start.sh never sets it.
     - The API merges the repo's .env.local into its config.
     - Scenario: after this merges, a developer puts POCKETQA_AUTH_MODE=firebase (or, in increment 2,
       POCKETQA_STORAGE=r2) in the main repo's .env.local to try the feature. The next preview restart:
       - starts the public demo API in firebase mode, so the shared demo accounts can't sign in;
       - opens POST /auth/identity/session behind a gate that is now effectively public, because the gate doesn't block
         it;
       - in increment 2, would point the demo at real buckets.
     - The ADR claims "the shared demo can't run in r2 mode", but nothing makes that true for the real preview.
     - Fix:
       - In start.sh, set POCKETQA_SHARED_DEMO=1 POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local explicitly on the API
         command (the process environment overrides .env.local).
       - Add POST /auth/identity/session to PREVIEW_BLOCKED_API as a second layer.
       - Add a scripts test that start.sh passes those variables, and a gate test for the new block entry.
  2. [P3] has_recovery counts unverified sign-ins as a recovery method. app.ts:113-116
     - Any non-custom sign-in sets has_recovery = 1, including a password sign-in with an unverified email, or
       anonymous.
     - Scenario: in increment 3, a wallet-only user links an unverified (possibly mistyped) email in the client SDK and
       signs in with it once. They then become eligible to unlink their wallet and lock themselves out.
     - Fix: Set has_recovery only when emailVerified is true and the provider is in an explicit allow-list (password,
       google.com).
  3. [P3] Verified email is required only for password sign-ins. account.ts:96: if another provider is ever enabled
     (GitHub, Facebook), an unverified email could claim someone else's address. That blocks the real owner's sign-up
     and shows a false email to builders.
     - Fix: Require emailVerified for every provider, and keep an allow-list of accepted sign-in providers.
  4. [P3] A provider failure during logout skips the playback-token cleanup. account.ts:175-180: if revokeSessions
     throws, the request returns 500 before the playback tokens are deleted. The server-side valid_after_ms has already
     taken effect, which is good, but playback URLs survive.
     - Fix: Delete the playback tokens before calling the provider. Catch and log the provider error and still return
       OK, since server-side revocation is already in force.
  5. [P3] Logout semantics aren't documented.
     - It's global: valid_after_ms is set on every identity of the user, and revokeRefreshTokens signs out every
       device.
     - Signing back in within the same second as logout fails for up to a second.
     - Fix: Document both in ADR 0005, and have the client handle the brief 401.
  6. [P3] The fake provider doesn't model refreshed tokens. test/fakeIdentity.ts:29-30, :56 treats iat as auth_time. In
     real Firebase, a refreshed ID token has a new iat but the original auth_time, and the real adapter correctly uses
     auth_time. No test covers "a token minted from a pre-logout sign-in but refreshed afterwards is refused".
     - Fix: Give the fake a separate auth_time, and add that test.

  VERDICT: CHANGES_REQUIRED
