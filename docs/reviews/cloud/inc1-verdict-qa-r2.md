# pqa-qa security verdict, cloud increment 1, round 2 (verbatim pane output; frozen tree de8890ff)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env* or credential files. The r1 P2 and all five P3s are fixed, and the parts I approved in r1 haven't
  regressed.

  Round-1 findings

  1. [P2] Shared demo not pinned — FIXED.
     - start.sh:27-30 now starts the preview API with POCKETQA_SHARED_DEMO=1 POCKETQA_AUTH_MODE=local
       POCKETQA_STORAGE=local. The process environment overrides .env.local, because the config merges the process
       environment last.
     - A stray FIREBASE_AUTH_EMULATOR_HOST in .env.local now stops the preview from starting rather than weakening it.
     - The gate also refuses POST /auth/identity/session (gate-server.mjs:65).
     - The candidate reports the scripts and gate tests failed before the fix and pass after.
  2. [P3] has_recovery — FIXED. It's set only when isRecoverableSignIn is true, meaning password or Google with a
     verified email (identity/types.ts:33-36, app.ts:113-116).
  3. [P3] Provider allow-list — FIXED. A verified email is required for every provider (account.ts:98), and only
     password and Google can create an account (:99). The test at identity.test.ts:58-65 covers an unverified GitHub
     email, a verified phone sign-in and a verified Google sign-in.
  4. [P3] Logout ordering — FIXED. Playback tokens are deleted before the provider call (account.ts:177), and a
     provider failure is logged and doesn't change the response (:184). The test at identity.test.ts:120-133 checks the
     tokens are cleared and that the old ID token still gets 401 through the server-side revocation alone.
  5. [P3] Docs — FIXED. ADR 0005 §1 now covers global logout, the same-second retry, the accepted providers and the
     preview pinning.
  6. [P3] Fake provider — FIXED. The fake now carries a separate auth_time, and refresh() keeps the original one
     (fakeIdentity.ts:28-43). A new test checks that a token refreshed after logout is refused.

  Regression check
  - Forged, wrong-audience, expired, custom and local-session tokens all still get 401 (identity.test.ts:84-99).
  - The no-merge, admin-claim, suspension and two-user isolation tests still pass.
  - The emulator guards and local mode are unchanged.
  - Evidence: pnpm verify EXIT=0 (API 292 plus 2 emulator-only), and pnpm test:emulator 2/2.

  New findings (P3, non-blocking)

  1. [P3] The refreshed-token test can't tell which revocation caught the token. identity.test.ts:111-118: the fake's
     own provider revocation already refuses the refreshed token (its auth_time is several seconds before revokedAt),
     so the test passes even if the server-side valid_after_ms check didn't exist.
     - Fix: Add a variant where revokeSessions is a no-op or fails, then check that a refreshed pre-logout token still
       gets 401.
  2. [P3] POCKETQA_STORAGE is set but nothing reads it yet. start.sh sets POCKETQA_STORAGE=local, but config.ts doesn't
     read that variable until increment 2.
     - Fix: In increment 2, loadConfig must parse POCKETQA_STORAGE and refuse r2 together with POCKETQA_SHARED_DEMO=1.
       Add a test like the existing shared-demo/firebase one.
  3. [P3] The unsupported-provider error uses a misleading code. account.ts:99: an unsupported sign-in provider gets
     403 FORBIDDEN_ROLE, which a client may read as a role problem.
     - Fix (optional): Use a dedicated code (for example PROVIDER_UNSUPPORTED) or VALIDATION, and handle it in the app.

  VERDICT: APPROVE
