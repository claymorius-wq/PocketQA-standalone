# Freeze candidate: protected web preview (pocketqa.optijara.ai), local parts only

**Branch:** `feat/preview-gate` (uncommitted until review). **Base:** `main` at `9d82008`. **Author:** lead (solo, claude-opus-5-5). **Reviewer:** `pqa-qa` (read-only).

**Authorization:** Hamza approved a protected preview, and confirmed it in-session. The parent then restricted this session to project-local work. No tunnel, registry or DNS changes were made from here, and reads of those files were denied and not retried another way.

## What's in it
- `scripts/preview/gate-server.mjs`:
  - password gate with an HMAC-signed `__Host-pqa_gate` cookie (HttpOnly, Secure, SameSite=Strict, 12 h) on every path;
  - static serving of the production web export, with SPA fallback and a traversal guard;
  - same-origin `/api/*` proxy to the loopback API (gate cookie stripped, bearer passed through, upstream `set-cookie` dropped);
  - Host allow-list (421 otherwise), Origin check on login (403), login rate limit (10 per IP and 100 globally per 15 min, then 429);
  - security headers and CSP; no HTTP Basic auth.
- `scripts/preview/init-preview.mjs`: generates the gate password and secret into git-ignored `.preview/` (0700; files 0600). It prints no secrets.
- `scripts/preview/build-web.sh`: `EXPO_PUBLIC_API_URL=/api` production export to `apps/mobile/dist-preview`. It fails if a loopback API origin is in the bundle.
- `scripts/preview/start.sh`: runs the API (loopback, `preview-data/` forced to 0700) plus the gate. It exits if either stops, and the ports are configurable.
- `scripts/preview/seed-demo.mjs`: synthetic demo studies and accounts through the real API; the admin comes from the offline CLI. Sign-ins are appended to `.preview/access.txt` (0600) only.
- `scripts/preview/smoke.mjs` (HTTP) and `apps/mobile/e2e/preview/browser-smoke.mjs` (Chromium): local or public verification that prints statuses only.
- Docs: `docs/decisions/0004-protected-preview.md` (decision and threat model), `docs/handoff/preview-activation.md` (exact commands plus the parent's external steps).
- Config: `.gitignore` adds `.preview/`, `preview-data/`, `apps/mobile/dist-preview/`. ESLint ignores those and gains a `URLSearchParams` global.
- No app or API code changed.

## Evidence
- **Gate unit tests:** `scripts/preview-gate.test.mjs`, 14/14 on OS-assigned ports.
  - They were written after the code, so these mutations back them; each is caught: G1 gate disabled, G2 cookie forwarded, G3 no Secure, G4 no Host check, G5 no Origin check, G6 no rate limit, G7 no traversal guard, G8 HMAC unchecked.
  - The traversal test uses a decoy file next to the web root.
- **`pnpm verify`:** EXIT=0 (`pnpm-verify.txt`). Secrets 370 files clean; root node tests 21; contracts 14, domain 168, api 271, mobile 124.
- **Production export:** one external `<script src>` and no inline scripts. The loopback-origin grep is clean.
- **Local run** on OS-chosen ports, gate 127.0.0.1:57891 and API 127.0.0.1:57892, both loopback (`lsof`):
  - `http-smoke.txt`: 15/15, using the public Host header. Unauthenticated page, asset and API requests are rejected, a wrong password is rejected, an unknown Host gets 421, the cookie attributes are right, the proxied app sign-in works, a bearer without the gate cookie gets 401, and admin self-registration gets 400.
  - `browser-smoke.txt`: 12/12 in Chromium. Gate first; tester, builder and admin sign in; the devnet and test-credit labels show; **0 requests left the preview origin**; 0 CSP violations. Screenshots in this folder.
  - A first browser run failed one check because it counted list text before the list loaded. The fix waits for the text, and two consecutive runs then passed.
- **Data:** `preview-data/` is a fresh DB (0700) holding only synthetic data. `.preview/access.txt` and `gate-secret.json` are 0600. No secret appears in any evidence file.

## Security review r1 fixes (`verdict-qa-r1.md`: CHANGES_REQUIRED, 1×P2 and 6×P3; all addressed)

- **P2: shared demo accounts and uploads.** The gate refuses, without reaching the API (403 `FORBIDDEN_ROLE`, plain message, `Connection: close`):
  - evidence uploads;
  - `DELETE /me`;
  - admin moderation of users and studies.

  Proxied paths with `%`, `//` or dot segments get 400, so the list can't be sidestepped. Allowed calls on the same resources still pass (GET evidence, GET /me, dispute resolve). The gate page and access file warn that accounts are shared. ADR 0004 records typed text and the shared admin as accepted risks.
- **P3: concurrent bypass and blocking scrypt.** scrypt is now async. In-flight caps are 2 per IP and 8 globally (429 beyond), and the limit is re-checked after the body arrives. A test sends 30 concurrent wrong passwords and gets at most 10 verifications.
- **P3: global lockout.** The global cap is raised to 1000 per 15 min, and lockout is documented as an accepted risk (existing sessions unaffected).
- **P3: CSP on API responses.** Every `/api/*` response gets `default-src 'none'; sandbox`.
- **P3: scanner.** `check-secrets` now forbids `.preview/` and `preview-data/` (test red, then green).
- **P3: proxy and session gaps.**
  - Headers named in `Connection` are stripped.
  - Logout revokes the nonce server-side, so a copied cookie stops working.
  - A timer prunes the failure and revocation maps.
  - A gated API 401 now uses the client-parseable code `UNAUTHENTICATED` with `gate: true`.
- **P3: CLAUDE.md.** It now carries the single scoped exception, pointing to ADR 0004.

**r2 evidence:**
- Gate tests: 19/19, and 26 root node tests in total. Mutations G1–G13 are each caught, and the file was verified restored with `cmp`.
- `pnpm verify`: EXIT=0, secrets 376 files clean.
- `http-smoke.txt`: 18/18. `browser-smoke.txt`: 12/12, with 0 foreign requests and 0 CSP violations.

## Security review r2 (`verdict-qa-r2.md`: APPROVE) and its P3s, fixed for r3
- **Slow logins:** the scrypt slot is now taken only after the body is complete, and login requests time out after 10 s. Test: 8 trickled logins from 4 IPs no longer block a real viewer (red, then green). Mutation G15, the old behaviour, is caught.
- **Path characters:** `;` and `\\` are rejected in proxied paths (red, then green). Mutation G14 is caught.
- **ADR 0004:** the stale lines are fixed.
- Gate tests: 20/20.

## Security review r3 (`verdict-qa-r3.md`: APPROVE) and its P3, fixed for r4
- The P3: the login timeout was a socket idle timeout (`req.setTimeout`). It's now a per-request total deadline, cleared on body end or response close.
- **Leftover timer on a reused connection:** a test runs a login, then a proxied call slower than the timeout, on the same keep-alive socket. It passed both before and after the change. Node's server replaces the socket timeout with its keep-alive timeout after each response, so the leftover-timer scenario didn't reproduce. It's kept as a regression test.
- **Trickled body:** the reviewer's other point, that a trickle resets an idle timeout, *did* reproduce. A test sends a byte every 80 ms with a 300 ms deadline. It failed red with the socket timeout (not cut off within 2 s) and passes with the per-request deadline.
- Gate tests: 22/22.

## Not done here (by instruction)
Port reservation in the registry, the fleet-commander ingress rule, the DNS route, the tunnel reload and public TLS/DNS verification are all for the parent; see `docs/handoff/preview-activation.md`.
