# 0004: Protected web preview (authorized exposure, isolated data)

**Status:** accepted 2026-10-03. Hamza explicitly approved a protected web preview at `pocketqa.optijara.ai`, and confirmed it in-session.

**Scope:** for this isolated preview only, this supersedes the "local-only, no deployment" rule. Everything else stays local-only. There is no store submission, no mainnet, no paid provider, and no GitHub push.

## Decision

- **Web only, read through a gate.** A small Node server (`scripts/preview/gate-server.mjs`) is the only origin the tunnel reaches. It serves the production `expo export` web build and proxies `/api/*` to the Pocket QA API.
- **The API stays bound to 127.0.0.1.** Its config still refuses non-loopback hosts.
- **The browser only talks to the preview origin.** The bundle's API base is the relative path `/api`, so the browser never calls localhost. `build-web.sh` fails if a loopback API origin appears in the bundle.
- **Gate:** a password login that sets the `__Host-pqa_gate` cookie (HttpOnly, Secure, SameSite=Strict, Path=/, no Domain, 12 h).
  - The cookie is HMAC-SHA256 signed with a 32-byte key.
  - The password is stored only as an scrypt hash. The secret file is mode 0600 and git-ignored (`.preview/gate-secret.json`).
  - There is no HTTP Basic auth, so the app's `Authorization: Bearer` session passes through unchanged.
  - The gate cookie is stripped before proxying, so the API never sees it.
  - Cloudflare Access wasn't verifiable from this session, so this gate is the control. Access can be added in front later.
- **Data:**
  - A fresh database lives in the git-ignored `preview-data/` (0700).
  - It holds only synthetic demo accounts and studies, created through the real API (`scripts/preview/seed-demo.mjs`). The admin is created with the offline `admin:create` CLI.
  - It never reuses dev, test or device databases.
  - Credentials exist only in `.preview/access.txt` (0600, git-ignored).

## Threat model (preview-specific)

| Threat | Control |
|---|---|
| Anyone on the internet reaches app pages, assets or the API | Every path except `GET/POST /__gate/login` needs a valid gate cookie. Pages and assets get a 303 to the login page; `/api/*` gets 401 `{code: "UNAUTHENTICATED", gate: true}`, a code the app's error parser understands. Tests: `scripts/preview-gate.test.mjs`. Mutations G1 and G8 are caught. |
| Password guessing | 192-bit random password, stored as scrypt (N=2^15) and verified **asynchronously**. 10 failures per client IP per 15 min (`CF-Connecting-IP`), then 429; the limit is re-checked after the body arrives. At most 2 concurrent verifications per IP and 8 overall, so a burst can't bypass the limit or stall the server: 30 concurrent wrong passwords give at most 10 verifications. The listener is loopback-only, so the IP header can only come from cloudflared. Mutation G6 is caught. |
| Forged, extended or copied cookie | HMAC over version, expiry and nonce, compared with `timingSafeEqual`. The expiry is checked. Logout revokes the nonce server-side, so a copied cookie dies at logout. Revocations live in memory: a restart forgets them, and `--rotate` invalidates all sessions. |
| CSRF on the login | `Origin` must be the preview host (403 otherwise), plus SameSite=Strict. Mutation G5 is caught. |
| Host-header confusion or a misrouted tunnel | Only the public host and the loopback `host:port` are accepted; anything else gets 421. Mutation G4 is caught. |
| Path traversal from the static root | Normalized paths outside the root fall back to `index.html`. Tested with a decoy file next to the root; mutation G7 is caught. |
| The gate cookie leaking to the API or its logs | `cookie` counts as a hop-by-hop header in the proxy, as does any header named in `Connection`. Mutation G2 is caught. The API's logs already redact `/media/` tokens. |
| Uploaded or JSON content rendered as a page | Every `/api/*` response gets `Content-Security-Policy: default-src 'none'; sandbox` plus `nosniff`. |
| Clickjacking, sniffing, indexing | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, `nosniff`, `noindex`, HSTS, `Referrer-Policy: no-referrer`. The app CSP is `script-src 'self'`; the export has no inline scripts, and the browser smoke saw 0 CSP violations. |
| Privilege escalation | Unchanged app authorization. `role: admin` can't self-register (the smoke check gets 400), and admin is created offline. |
| Real value implied | Devnet and test-credit labels are unchanged, and the gate page says "Devnet and test credits only. No real payments." Wallet linking is Android-only, so the web preview can't sign anything. |
| Shared demo accounts (review r1 P2) | Every gate holder shares the tester, builder and admin sign-ins. So the gate **refuses**, without reaching the API (403 `FORBIDDEN_ROLE` with a plain message):<br>- evidence uploads (`POST /participations/:id/evidence`), so nobody's own files become visible to other viewers;<br>- `DELETE /me`;<br>- admin moderation of users and studies (`POST /admin/moderation/(users\|studies)/:id`).<br>Proxied paths with `%`, `;`, `\\`, `//` or dot segments get 400, so the block list can't be sidestepped. The gate page and the access file warn that accounts are shared and that personal information shouldn't be typed. |
| Data exposure | Synthetic data only, in an isolated DB. Text a viewer types (study text, notes, reasons) is visible to other viewers. That's an **accepted risk** for the demo, and it's warned about. The shared admin can still resolve disputes and decide stuck work, which is the admin demo, and only on synthetic data. |
| Lockout by spraying wrong passwords | A global cap of 1000 failures per 15 min across all IPs blocks **new** gate logins, while existing sessions keep working. This is an **accepted** denial-of-service risk for a private preview. Mitigations: Cloudflare Access in front, or rotating the URL. |

## Residual risks and follow-ups

- **Shared password:** it is shared among everyone given the link. Rotate it with `init-preview.mjs --rotate`, which also signs everyone out.
- **Slow logins:** a login body has a total deadline of 10 s, using a per-request timer that is cleared when the body arrives, so it never affects later requests on a reused connection. The scrypt slots are taken only after the body is complete, so trickled requests can't hold them (reviews r2 and r3, P3).
- **Cloudflare Access** would add identity-based access in front of the gate. That's the parent's choice when deploying.

## Addendum, 2026-10-03: shared public demo convenience (supersedes "protected" for this preview)

**Decision (Hamza, confirmed in-session).** Easier access was requested and accepted, after being told that it removes meaningful access protection:
- The gate password is set to a simple, known value.
- The password is **prefilled** on the gate page.
- After the gate, the app's sign-in screen is prefilled with the demo tester. A Tester/Builder/Admin picker fills the matching demo sign-in, and the visitor still presses Sign in.

**What this means, stated plainly.** For anyone who has the URL, the gate is now a **publicly discoverable convenience, not access protection or privacy**.
- Treat everything in the preview as public: the synthetic studies, notes and reasons, and the shared demo accounts, including the shared admin.
- The gate page says so ("this page is not access protection"), and the sign-in footer says "Public demo preview · synthetic data".
- Nothing in this preview may hold real data.

**What is unchanged.**
- **Technical controls stay in place:**
  - every path still needs the gate cookie;
  - per-IP, global and in-flight login limits;
  - Origin, Host and path canonicalization checks;
  - the `/api` proxy rules and CSP;
  - logout revocation;
  - the API bound to loopback.
- **The shared-preview blocks stay:** no uploads, no `DELETE /me`, no admin moderation. This addendum adds a block on self-registration (`POST /auth/register`).
- **Labels:** devnet-only and test-credit labels are unchanged, and the data is synthetic only.

**How the credentials are handled.**
- No credential is compiled into any bundle or committed file. The preview web build only has `EXPO_PUBLIC_PREVIEW=1`, which turns on a same-origin fetch of `/__preview/bootstrap.json`. Native and local web builds never fetch it.
- The gate serves that file **only after the gate**, from the git-ignored 0600 `.preview/convenience.json`, which `scripts/preview/enable-convenience.mjs` writes.
- The gate refuses to start if the prefill doesn't match the stored scrypt hash.
- The file may list only the seeded `demo-{tester,builder,admin}@pocketqa.example` accounts. The app also drops anything else.
- `build-web.sh` fails if any generated secret value appears in the bundle.

**Abuse: open publishing on the optijara.ai domain (accepted, with takedown).**
- With the gate public, anyone can sign in as the shared builder or admin. They can publish studies, task text, notes or dispute resolutions that every visitor sees, and the copy rules don't filter links or offensive text.
- Self-registration is refused at the gate (`POST /auth/register` gives 403), and the preview hides "Create an account".
- Moderation is blocked, so the in-app admin can't take content down.
- **Takedown and reset (operator):**
  1. Stop the preview.
  2. Move `preview-data/` aside, or delete it.
  3. Start it again and run `seed-demo.mjs`. That creates new demo passwords in `.preview/access.txt`.
  4. Run `enable-convenience.mjs` with the gate password, then restart.
  - For immediate takedown, run `enable-convenience.mjs --off`, then `init-preview.mjs --rotate` (a random password), then restart.
- Reset on a schedule if the preview stays up.

**Rotation.**
- `printf '%s' '<new>' | node scripts/preview/init-preview.mjs --rotate --password-stdin` writes a new salt, hash and cookie key using the same scrypt scheme, so all old gate sessions stop working. Re-run `enable-convenience.mjs` with the new value, then restart.
- `enable-convenience.mjs --off` plus a restart returns to a password-only gate. Then rotate to a random password (`init-preview.mjs --rotate`) to make the gate meaningful again.
