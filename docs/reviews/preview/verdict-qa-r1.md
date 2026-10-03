# pqa-qa security verdict, protected preview, round 1 (verbatim pane output; frozen tree c4108461)


  Read 9 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and did not open .preview/
  or preview-data/. The gate itself is sound, but one P2 blocks public exposure.

  What holds up in gate-server.mjs
  - Nothing served without the cookie: every path except GET/POST /__gate/login needs a valid gate cookie (:246-250).
    Pages get 303 and the API gets 401, and the test checks nothing reaches the upstream.
  - Cookie:
    - HMAC-SHA256 over version, expiry and nonce, with a constant-time compare and an expiry check (:55-70).
    - __Host- prefix, HttpOnly, Secure, SameSite=Strict, Path=/, no Domain.
    - A 32-byte key, and the secret file must be mode 0600.
  - Password: 192 bits of randomness (init-preview.mjs:28), stored only as an scrypt hash. Neither script prints a
    secret.
  - Host and Origin: unknown Host gets 421; a cross-site login Origin gets 403.
  - Static serving: the path is decoded, NUL is rejected, and the result must stay under the web-root prefix, otherwise
    index.html is served. Absolute-form URLs (http://x/...) never match /api and fall back to index.html.
  - Proxy:
    - forwards only to a loopback origin;
    - strips the cookie, host, hop-by-hop and transfer-encoding request headers;
    - drops the upstream's set-cookie;
    - keeps the app's bearer token;
    - rebuilds the request rather than passing raw bytes, so there's no request-smuggling path.
  - Headers: CSP plus clickjacking and indexing headers are set, and the browser smoke saw 0 CSP violations and 0
    requests leaving the preview origin.
  - API stays local: loopback only, preview-data/ is git-ignored with its own fresh database, and the admin is created
    offline.
  - Evidence: http-smoke.txt (15/15) and browser-smoke.txt (12/12) print statuses only, no secrets.

  Findings

  1. [P2] Every viewer shares the same demo accounts, admin included, and file uploads are on.
     scripts/preview/seed-demo.mjs:45-49, :92-101; ADR 0004 "Data exposure" row
     - Everyone given the gate password also gets the tester, builder and admin sign-ins, and the web preview offers
       "Attach screenshot or clip".
     - Scenario:
       i. A viewer signed in as the demo tester attaches a real screenshot from their own device and uploads it.
       ii. Every other gate holder can play it back as the builder, or through the admin's evidence access.
       iii. The same viewers can also suspend the demo accounts, decide stuck work, or DELETE /me a shared account,
            which breaks the demo for everyone.
     - ADR 0004 accepts only that typed text is shared. The note in access.txt may never reach a viewer who is just
       sent a URL and password. CLAUDE.md requires media to be strictly owner/role authorized.
     - Fix:
       - In preview mode, have the gate refuse POST /api/participations/:id/evidence, plus DELETE /api/me for the
         seeded accounts, and preferably the admin moderation routes. Return a clear 403 message.
       - Alternatively, issue per-viewer accounts and keep the admin password off the shared sheet.
       - At minimum, show an in-app banner ("Shared demo; uploads are visible to other viewers; don't upload personal
         content"), and record uploads and admin sharing as accepted risks in ADR 0004.
  2. [P3] The login rate limit can be bypassed with concurrent requests, and scrypt blocks the server.
     gate-server.mjs:151-185
     - limited(ip) runs when the request arrives, but recordFail runs only after scryptSync in the end handler.
     - Scenario: a burst of thousands of concurrent login POSTs all pass the check before any failure is recorded. Each
       then runs a synchronous scrypt (N=2^15) on the event loop, stalling every viewer for minutes.
     - The 192-bit password makes guessing hopeless, but the documented "10 per IP" control doesn't hold, and anyone
       without a cookie can cause the stall.
     - Fix:
       - Re-check limited(ip) inside end before verifying.
       - Count in-flight attempts per IP and globally, and refuse extras with 429.
       - Use async crypto.scrypt.
       - Add a test that sends 30 concurrent wrong passwords and expects at most 10 401s.
  3. [P3] The global failure limit lets anyone lock everyone out of the login. gate-server.mjs:143: 100 wrong passwords
     from any IPs block logins for all viewers for 15 minutes, and an attacker can repeat this. Existing cookies keep
     working.
     - Fix: Slow requests down globally instead of blocking them, or raise the global cap well above the per-IP limit.
       Document the behaviour in ADR 0004.
  4. [P3] Proxied API responses, which include user-uploaded media, get no CSP. gate-server.mjs:202: uploads are served
     from the preview origin. The server sniffs file types and sends nosniff, so this is defence in depth only.
     - Fix: Add content-security-policy: default-src 'none'; sandbox to every /api/* response.
  5. [P3] The secret scanner doesn't treat the preview folders as forbidden. scripts/check-secrets.mjs FORBIDDEN_PATHS
     doesn't list .preview/ or preview-data/. A force-added .preview/access.txt (lines like "Gate password: …" and
     "Tester: email / pw") matches no content rule, so it would pass.
     - Fix: Add both folders to FORBIDDEN_PATHS, with a test.
  6. [P3] Gaps in the proxy and session handling.
     - Headers named in Connection: aren't stripped (:41, :197).
     - Logout only clears the cookie in the browser. A copied cookie stays valid for 12 hours unless the key is
       rotated.
     - The fails map is pruned only when the same IP returns, so it slowly grows.
     - Fix: Parse Connection tokens into the strip set, and prune fails on a timer. Optionally keep a small server-side
       list of revoked cookie nonces.
  7. [P3] CLAUDE.md still forbids exposure. CLAUDE.md still says "no cloudflared/deployment … for this local build".
     ADR 0004 and the candidate record Hamza's approval in-session, which I can't verify from the files.
     - Fix: Before the parent exposes anything, Hamza should confirm in writing, and CLAUDE.md should carry the scoped
       exception (this preview host only) so the project instructions and ADR 0004 agree.

  VERDICT: CHANGES_REQUIRED
