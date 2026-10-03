# pqa-qa security verdict, protected preview, round 2 (verbatim pane output; frozen tree 929e896a)

  Read 8 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and did not open .preview/
  or preview-data/. The round-1 P2 and all six P3s are fixed. I found no way past the new block list and no
  regressions. Three P3s remain, none blocking.

  Round-1 findings

  1. [P2] Shared accounts and uploads — FIXED. PREVIEW_BLOCKED_API (gate-server.mjs:61-65) refuses evidence uploads,
     DELETE /me, and user and study moderation at the gate. It returns 403 FORBIDDEN_ROLE with a plain message, never
     reaches the API, and closes the connection without reading the upload (:272-278). The gate page and ADR 0004
     (:39-40) warn that the accounts are shared.

     I tried to find another spelling that reaches a blocked route:
     - Percent-encoding, //, dot segments: rejected with 400 before the block-list check (:267).
     - Query strings: removed before matching (rawPath).
     - Single trailing slash: normalised before matching (:272).
     - Case variants (/ME): these get past the block list, but the API's routes are case-sensitive, so they 404 and
       never reach a handler.
     - Method override: Fastify doesn't honour override headers by default, and lowercase methods are rejected by
       Node's parser.
     - Absolute-form URLs: never match /api and fall back to static serving.

     Allowed calls on the same resources still pass (GET evidence, GET /me, dispute resolve), and the tests at
     preview-gate.test.mjs:221-258 check that nothing reaches the upstream.
  2. [P3] Concurrent bypass and blocking scrypt — FIXED. verifyPassword is now async (:73-80). The per-IP limit is
     re-checked after the body arrives (:242), and in-flight logins are capped at 2 per IP and 8 overall (:216). The
     test (:269-279) sends 30 concurrent wrong passwords and gets at most 10 verified.
  3. [P3] Global lockout — FIXED. The global cap is raised to 1000 failures per 15 minutes, and ADR 0004 :41 records it
     as an accepted risk.
  4. [P3] No CSP on API responses — FIXED. Every /api/* response, including gate errors, now carries default-src
     'none'; sandbox (:123, :258, :287, :334). That header doesn't stop the same-origin <img> and <video> playback from
     working.
  5. [P3] Scanner gap — FIXED. check-secrets.mjs:55-57 now forbids .preview/ and preview-data/.
  6. [P3] Proxy and session gaps — FIXED.
     - Headers named in Connection are stripped in both directions (:49-55, :279, :284).
     - Logout revokes the nonce on the server (:339-343), and the test checks a copied cookie then gets 401.
     - A timer prunes the failure and revocation maps (:164-173).
     - The gate's 401 now uses the code UNAUTHENTICATED with gate: true, which the app's client already handles.
  7. [P3] CLAUDE.md — FIXED. CLAUDE.md:11 now carries the single scoped exception (Hamza, 2026-10-03, this preview host
     only, per ADR 0004).

  Regression checks
  - Every path except the login page still needs a valid cookie.
  - The app's bearer token still passes through the proxy (test :164-183).
  - The login flow and the 502 error path still work.
  - http-smoke.txt 18/18, browser-smoke.txt 12/12, pnpm verify EXIT=0 with 376 files clean.

  New findings (P3, non-blocking)

  1. [P3] Slow logins can tie up the login slots. gate-server.mjs:216-228: a login takes an in-flight slot as soon as
     its headers arrive, before the body.
     - Scenario: an attacker with four IPs opens 8 login POSTs and trickles the bodies. All 8 global slots stay taken
       until Node's request timeout (up to 300 s), so every new gate login gets 429. They can repeat this indefinitely.
       Existing sessions keep working.
     - Fix: Take the slot only around the verifyPassword call (after end), and set a short timeout on login requests,
       for example req.setTimeout(10_000, () => req.destroy()).
  2. [P3] The proxy path check doesn't reject ; or \. :267: today Fastify 5 treats ; as part of the path, so /me;x
     404s. If useSemicolonDelimiter were ever turned on, DELETE /api/me;x would reach /me and bypass the block list.
     - Fix: Add ; and \\ to the rejected characters.
  3. [P3] ADR 0004 has two stale lines.
     - :28 still says the gate returns 401 GATE_REQUIRED; it now returns UNAUTHENTICATED with gate: true.
     - :46 still warns about uploads filling preview-data/media, but uploads are now refused.
     - Fix: Update both lines.

  VERDICT: APPROVE
