# pqa-qa verdict: web-launch-qa-r1 (security and product)

**Candidate:** the worktree `.worktrees/web-launch`, branch `feat/web-launch-e2e` from `main` `4b48a29`.
- Code at `2f5cec4`; evidence and docs at `5c63815`.
- Reviewed `git diff 4b48a29..5c63815`: 21 files.

**Rules held:**
- Read-only, and no other file changed. The worktree was clean before this file.
- **No contact with Firebase or R2:** I didn't run the live E2E, and the web-server probes used an in-process fake upstream on loopback.
- No subagents and no advisor.

## What I ran (Node v24.21.0)
- **`node --test scripts/production-web-server.test.mjs`:** 9/9 pass.
- **`npx jest __tests__/auth-screens.test.tsx`** (`apps/mobile`): 41/41 pass, including "an account created without its email says so and points to sign-in".
- **A local front-door probe** (scratch script, deleted afterwards). It called `createWebServer` with a fake upstream on random loopback ports:
  - **Traversal:** `/%2e%2e/secret.txt`, `/..%2fsecret.txt` and `/%2e%2e%2fsecret.txt` all gave 200 **index.html**, never the file outside the root.
  - **Non-canonical API paths:** `/api/..%2fhealth`, `/api//health`, `/api/x/../health` and `/api/%2e%2e/` all gave **400 VALIDATION**.
  - **Host pinning:**
    - `pocketqa.optijara.ai.` (trailing dot), `…:443` and `evil.example` gave **421**;
    - an upper-case Host gave 200, because it's normalised.
  - **Proxy behaviour:**
    - the bearer is kept, and the client cookie isn't forwarded;
    - an upstream `set-cookie` is dropped;
    - the API response has `default-src 'none'; sandbox`;
    - a POST is forwarded with `/api` stripped.
  - **Static headers:** HSTS, XFO, CSP, COOP and Permissions-Policy are all present.
  - **Client-supplied `X-Forwarded-For` and `X-Forwarded-Host` reach the API verbatim** (P3-1).

## 1. Front door: `scripts/production/web-server.mjs` and `deploy/launchd/ai.pocketqa.web.plist`
- **CSP** (`web-server.mjs:63-66`):
  - `script-src 'self'`, with no inline script;
  - `style-src 'unsafe-inline'`, which React Native Web needs;
  - `connect-src 'self'` plus exactly `identitytoolkit`, `securetoken` and `https://<32-hex>.r2.cloudflarestorage.com`, each validated as a bare https origin;
  - `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`.
  
  This is correct for email/password Firebase plus presigned R2 PUT. Google sign-in would need more, and it's honestly excluded.
- **Static serving:** `decodeURIComponent`, then a NUL check, then `normalize(join(root, rel))` with a `startsWith(root + sep)` fence. A failure falls back to `index.html`. Only GET and HEAD are allowed. `index.html` is `no-store`, which supports instant rollback.
- **Proxy:**
  - hop-by-hop headers and those named in `Connection` are stripped both ways;
  - cookies are dropped both ways;
  - the API is fixed to loopback;
  - there's a 120 s upstream timeout;
  - an upstream error gives 502 JSON, or a destroyed socket if headers were already sent.
- **Intentionally absent compared with the preview gate:** the gate, the demo bootstrap and the API block list.
  - Production mode itself refuses demo, test-credit and devnet paths server-side (inc1), so the block list isn't needed.
  - Nothing else is weaker by accident, except for P3-1.
- **HSTS without a secure flag** (`web-server.mjs:56`): fine. The browser receives it over the tunnel's https, browsers ignore HSTS on plain-http loopback responses, and it has no `includeSubDomains`, so other `optijara.ai` hosts aren't affected.
- **The plist:**
  - it uses an absolute node path;
  - it holds no secret (the R2 account id is public);
  - `WEB_PUBLIC_HOST` is pinned to `pocketqa.optijara.ai`;
  - it has KeepAlive and a 10 s throttle.
  
  The listener binds `127.0.0.1` only (`web-server.mjs:165`). `import.meta.main` needs Node ≥ 24.2, and the engines allow ≥ 24.3.

## 2. Sign-up defect fix
- **`firebaseClient.ts:43-50`:** only `createUserWithEmailAndPassword` can fail the sign-up. A failed `sendEmailVerification` becomes `emailSent: false`.
- **`SessionProvider.tsx:211-225`:** after creation, the app signs out and stores the pending profile, then returns `'sent'` or `'unsent'`.
  - This removes the earlier stuck state, in which the user stayed signed in to Firebase without a profile under a false "Couldn't create".
- **`sign-up.tsx:74-79`:** the 'unsent' notice reads "Account created, email not sent… Sign in with this email and password to send it again". That's honest, and sign-in's `EMAIL_UNVERIFIED` path offers the resend.
- **Enumeration:** the change reveals nothing new. The notice concerns the account the user has just created. The existing-email error on sign-up is pre-existing Firebase behaviour and isn't changed here.
- **Minor:** `signOut` after a successful creation isn't in a `finally`. A throwing `signOut` would surface as "Couldn't create account" for an account that exists. This is very unlikely; P3-5.

## 3. Live harness
- **`e2e-live/start-api.mjs:19-28`:**
  - it forces `POCKETQA_ENV=development`, `RETAIN_NONPROD=1` and `ALLOW_DELETE=0` *after* loading the env files, so they can't be overridden;
  - it uses a fresh temp data dir and loopback port 8797;
  - the production guards in `config.ts` are untouched by this branch.
- **Preview isolation:** `ctx.route(\`${ORIGIN}/**\`)` fulfils every request to the production host from `127.0.0.1:8091` (`web-launch.spec.ts:41-45`). `route.fetch` only targets loopback, so the deployed preview can't be reached. No service workers or WebSockets are involved.
- **Secrets:**
  - `firebase-admin` is used only for `getUserByEmail` and `updateUser(emailVerified)` on the synthetic `@example.test` addresses (`:66`, `:75`);
  - the logs print only UIDs;
  - the evidence files hold UIDs, emails at `example.test`, object keys and sizes, and no credentials. `check-secrets` is part of the recorded verify run.
- **What the assertions prove:**
  - **R2 PUT 200 from the origin** (`:150-152`): the request's `origin` header equals the production origin. A cross-origin PUT with `content-type` needs a preflight, so a 200 PUT means the bucket's CORS rule admitted the origin. Completion (`Uploaded (1)`) then needs the server's HEAD of the object. **Proven.**
  - **`/api/media` 206** (`:182-186`): a 206 with a valid `Content-Range`, plus `<video>.readyState ≥ 2`, which means frames decoded. **Proven** (initial ranged reads; see P3-3 on seeking).
  - **404 isolation** (`:163-165`): a second real tester gets 404 from the API for the foreign participation. A tester deep-linking to a builder page lands on Discover. **Proven.**
  - **0 CSP violations** (`:48-50`, `:195-197`): console messages matching "Content Security Policy" or "Refused to" are collected, and the served document has the production CSP. **The negative control** (run 5 in `web-live-e2e.txt`, a wrong R2 origin) failed at the upload, as expected. That proves the CSP is enforced and the exact R2 origin is required. **It doesn't prove the console-based detector itself**, since the run failed before reaching the `seen.csp` check (P3-2).

## 4. Docs, ledger, progress and verification
- **Web acceptance is kept separate** from native, device, signing, wallet and payment gates (`web-launch.md` §5, §1 "Not covered").
- **The gates are honest** (`web-launch.md:123-135`):
  - A5 ⛔ (production refuses without `ALLOW_DELETE=1`);
  - A9 ⛔;
  - Firebase `IDENTITY_PLATFORM` and plan ⚠️ awaiting Hamza;
  - A7 ⬜, B4 ⬜, I5 ⬜;
  - the front door 🔧 awaiting pqa-qa;
  - wallet login off.
- **Billing is stated exactly as it happened:**
  - "A read-only Cloud Billing GET using the Firebase CLI login was **denied by this session's permission system**, and was not retried by any other route" (`web-launch.md:138`);
  - the same in `progress.md` and `verification.md`;
  - the Admin SA gets 403 because the Cloud Billing API is disabled, and enabling it isn't authorised.
- **The inventory adds up:** 17 synthetic users and 18 objects (8 from the 4 web uploads plus the earlier 10), nothing deleted, all on the A5 cleanup list.
- **The cutover and rollback** keep the preview running as the rollback. The lead never touches the tunnel. Step 3 is honest that production won't start before A5.

## Findings (no P0, P1 or P2)

### P3-1: client `X-Forwarded-For` and `X-Forwarded-Host` are passed through verbatim (`scripts/production/web-server.mjs:97`)
- Behind Cloudflare this is safe for the rate-limit key: the edge appends the real client IP, and the API (production `trustProxy: loopback`) takes the rightmost untrusted address.
- But the front door relies entirely on the tunnel for that, and forwards a client-chosen `X-Forwarded-Host` and `X-Forwarded-Proto`. The API doesn't use them today.
- **Fix (defence in depth):**
  - drop `x-forwarded-host` and `x-forwarded-proto`;
  - set `x-forwarded-for` from `cf-connecting-ip` (when the peer is loopback), or append `req.socket.remoteAddress`;
  - document that the tunnel must append the client IP.

### P3-2: the negative control is described as proving the CSP detector (`docs/production/web-launch.md:43`, `docs/progress.md:12`)
- The run failed at the upload, so it proves CSP *enforcement* and the exact R2 origin. It does **not** prove that the `seen.csp` console detector catches violations.
- **Fix:** reword it ("with a wrong R2 origin in `connect-src`, the browser blocks the upload, and the run fails at it"). Optionally make the detector robust with a `securitypolicyviolation` listener through `addInitScript`, and assert it fires in the control.

### P3-3: S4 says "with seeking", but the run asserts initial ranged reads only (`docs/production/acceptance-ledger.md:57`; `web-launch.spec.ts:182-186`)
- **Fix:** either add a seek (`video.currentTime = 2`, then a new 206 with a non-zero start), or drop "seeking" from the S4 evidence wording.

### P3-4: "for the reviewed SHA" before any review (`docs/production/web-launch.md:127`)
- **Fix:** say "for `2f5cec4` (evidence file); review pending", or keep it as is once this verdict is filed.

### P3-5: `signOut` after a successful creation isn't guarded (`apps/mobile/src/auth/SessionProvider.tsx:219`)
- **Fix:** wrap the post-creation `signOut` and the pending-profile write in try/finally. Then a failing sign-out can't turn a created account into "Couldn't create account".

### P3-6 (housekeeping): Playwright traces of failed live runs
- `trace: 'retain-on-failure'` (`playwright.live.config.ts:21`) keeps request logs with live bearer tokens and presigned URLs in `apps/mobile/test-results/`. That folder is git-ignored and the tokens are short-lived.
- **Fix:** delete `test-results/` after live runs (runs 1, 2 and 5 failed), or use `trace: 'off'` for the live config.

### P3-7 (optional hardening): narrow the CSP to the bucket path (`web-server.mjs:34`)
- CSP source expressions can include a path: `https://<acct>.r2.cloudflarestorage.com/pocketqa-evidence/`. That would narrow uploads from the page to the one bucket (path-style URLs are used).

## Verdict
**The front door, the sign-up fix and the live harness are sound.** The live assertions prove the R2 CORS PUT, the ranged playback, role isolation and an enforced CSP. The docs keep web acceptance separate and the gates honest, and billing is stated exactly as it happened.

**Live cutover remains blocked** by A5, A9, the Firebase plan and `IDENTITY_PLATFORM` console check, A7 and B4, as the docs say.

VERDICT: APPROVE
