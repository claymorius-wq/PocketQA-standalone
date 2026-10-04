# Web launch: acceptance, cutover and rollback

**Scope:** the web app at `https://pocketqa.optijara.ai`. Native Android/iOS, physical devices, release signing, real wallets, payments and publishing are **separate** gates (§5) and are not part of web acceptance.

**Status:**
- The web path is proven end to end against the real providers, with a non-production API and synthetic data (§1).
- **A5 is decided** (Hamza, 2026-10-04): Pocket QA may delete only its own app-managed objects in `pocketqa-evidence`, for failed-upload cleanup and user-requested (account) deletion. No automatic expiry, no other bucket, no bulk purge. Ownership is enforced by the `storage_objects` registry. Removing the temporary quarantine copy of an upload that succeeded (`upload_staging`; the recording stays as `evidence/<id>`) is the **lead's interpretation** of that decision, a temporary app-made duplicate. pqa-qa considers it inside the decision's spirit. It is **pending Hamza's or the parent's confirmation**; if the decision is read literally, stop the two `upload_staging` calls and keep those copies. The implementation is in its own review (§4). The web-launch approvals (pqa-qa r1–r3, `184e0a2`) do **not** cover it.
- **Live cutover has not happened and must not happen yet.** It needs the reviewed candidate, the open items in §4 (A9 and others), and the parent's tunnel change (§3).

## 1. What is proven (web, real providers, synthetic data)

`pnpm test:e2e:live` (`apps/mobile/e2e-live/web-launch.spec.ts`) drives the real app UI in Chromium (Playwright, Pixel 7 profile).

The setup is what production ships:
- the **production web build** from `scripts/production/build-web.sh`;
- the **production front door**, `scripts/production/web-server.mjs`, with its real CSP and the same-origin `/api` proxy.

The browser loads the app **as `https://pocketqa.optijara.ai`**. Playwright answers every request to that host from the local front door, so nothing reaches the deployed preview. The external services are real:
- **Firebase Auth** on `pocketqa-optijara`, using the real web API key and authorized domain;
- **Cloudflare R2** `pocketqa-evidence`, where the browser uploads directly to a presigned URL under the bucket's exact-origin CORS rule.

The API is isolated and **explicitly non-production**:
- `POCKETQA_ENV=development`, `POCKETQA_R2_RETAIN_NONPROD=1`, `POCKETQA_R2_ALLOW_DELETE=0`;
- a fresh temporary data dir, on loopback port 8797;
- `e2e-live/start-api.mjs`.

The production guards are unchanged: production refuses this mode.

| Step | What the run checks |
|---|---|
| Sign-up | Builder and two testers sign up on the real Firebase project. The verification email is sent, or the app says honestly that it wasn't (see the defect below). |
| Unverified sign-in | Refused with "Verify your email". |
| Verification | Firebase Admin marks the synthetic `@example.test` address verified, standing in for the inbox link. |
| Sign-in | Sign-in, then "Finish your account". |
| Funding | Builder funds with **non-production test credits**, which carry no value and are off in production. The builder creates a web study and publishes it. |
| Tester session | Tester saves a web device, consents, and starts the session. |
| Upload | The browser PUTs the synthetic WebM **directly to R2 from the production origin** and gets **200** (real CORS). Completion is verified, then the session is submitted. |
| Role isolation | A second real tester opening the first tester's session gets **404** from the API, and a tester deep-linking to a builder page lands on Discover. |
| Playback and approval | The builder opens the evidence. `/api/media/…` answers **206** with `Content-Range`, and the `<video>` reaches `readyState ≥ 2`. The builder then approves and the tester sees the approval. |
| Seeking | The player seeks to 2 s (the `seeked` event fires there). A mid-file range of the same media link (`bytes=1000-1999`) answers **206** for exactly those 1000 bytes. |
| CSP | Every page ran under the production CSP with **zero violations**. The detector is self-tested in each run: a fetch to an origin outside `connect-src` must be reported. |

**Enforcement is negative-controlled.** With a wrong R2 origin in `connect-src`, the browser blocks the upload and the run fails at it. The app shows "The upload didn't reach storage".

**Defect found and fixed by the live run.** Firebase sometimes answers the verification-email send with **503** right after creating the account.
- **Before:** the app said "Couldn't create an account…", and left the user signed in to Firebase without saving their role.
- **Now:** creation alone decides success. A failed send shows "Account created, email not sent" and points to sign-in, which offers the resend. The role and display name are kept.
- **Evidence:** unit tests in `__tests__/auth-screens.test.tsx`. The 503 occurred live in one of the recorded runs, and that run passed through the new path.

**Not covered by this run:**
- a real inbox (verification and password-reset links);
- Google sign-in (not enabled);
- wallets (no wallet is used, and no real-wallet claim is made);
- native apps;
- the full flow in production mode: production builders can't publish until A9. Production mode itself starts on the real providers (`docs/reviews/production/live/prod-start-smoke.txt`).

**Synthetic fixtures** (kept; nothing deleted). Historical test fixtures are not deleted gratuitously. The scoped policy can't delete them anyway, because they were never registered by a production database:
- Firebase users `pqa-weblive-*@example.test`;
- R2 objects under `quarantine/` and `evidence/` in `pocketqa-evidence`. Retention-only mode copies an object to `evidence/` and keeps the quarantine copy.

Counts and IDs: `docs/reviews/production/live/web-live-e2e.txt`.

## 2. The production web stack (code in this branch)

| Piece | Role |
|---|---|
| `scripts/production/build-web.sh` | Production export. Refuses the preview switch, loopback or http APIs, and demo accounts in the bundle. |
| `scripts/production/web-server.mjs` | Loopback front door: the static build with SPA fallback, `/api` proxy to the loopback API, Host pinning (421 otherwise), and canonical API paths. Cookies are dropped both ways. |
| `scripts/production-web-server.test.mjs` | Front-door tests. |
| `deploy/launchd/ai.pocketqa.web.plist` | Supervisor unit for the front door. It holds no secret. |
| `scripts/production/run-api.sh` + `deploy/launchd/ai.pocketqa.api.plist` | The API (runbook §2–3). |

**Front-door CSP:** `script-src 'self'`; `connect-src 'self'` plus exactly:
- `https://identitytoolkit.googleapis.com`;
- `https://securetoken.googleapis.com`;
- `https://<account>.r2.cloudflarestorage.com/pocketqa-evidence/`: the one bucket's path, since presigned URLs are path-style.

Media stays `'self'` because playback is proxied. `frame-ancestors 'none'`.

**Forwarding:** the front door drops client-supplied `X-Forwarded-*`, `Forwarded` and `X-Real-IP`. It sets `X-Forwarded-For` itself: CF-Connecting-IP when the peer is the loopback tunnel, otherwise the socket peer. The API's per-client rate limits therefore rely on cloudflared reporting the visitor. **Trust assumption:** any local process can connect to the loopback front door and set CF-Connecting-IP. So the front door stays loopback-only, behind the tunnel, on a single-tenant host, with no other local listener proxying to it.

**Front-door headers and caching:**
- HSTS, `nosniff`, `X-Frame-Options: DENY`, `no-referrer`;
- `index.html` is `no-store`, so a rollback takes effect on the next load.

**Not in the front door:** the preview gate, the demo bootstrap and the preview's API block list. The preview keeps its own server, unchanged.

## 3. Cutover procedure (only when §4 is all ✅, with the parent)

Each step names who runs it. **The lead never changes the tunnel, DNS or the running preview.**

1. **Candidate.** The exact reviewed SHA, with pqa-qa APPROVE recorded for it, on `main` through a reviewed PR.
2. **Host (A7).** A clean checkout of that SHA outside the preview's tree, then `pnpm install --frozen-lockfile` on Node 24.
3. **Secrets.**
   - Write `production.env`, mode 600, outside the repo (runbook §2).
   - Set `POCKETQA_ENV=production` and the real Firebase and R2 values.
   - Set `POCKETQA_PUBLIC_ORIGIN=https://pocketqa.optijara.ai`.
   - Set `POCKETQA_R2_ALLOW_DELETE=1`: the scoped deletion policy (A5, §4). Production refuses to start without it.
   - Keep wallet login off unless A8 is recorded.
4. **Build.** `PROD_API_URL=/api scripts/production/build-web.sh`.
5. **Start on new loopback ports** (the preview keeps its ports):
   - run the API (`ai.pocketqa.api`) and the web front door (`ai.pocketqa.web`) under launchd;
   - check `curl -sf http://127.0.0.1:<api>/health`.
6. **Pre-cutover smoke on loopback**, with `Host: pocketqa.optijara.ai`:
   - `/` gives 200 with the production CSP;
   - `/api/config` gives `authMode: firebase`, `storage: r2`, `features.testCredits: false`;
   - a foreign Host gives 421.
7. **Rehearsal.** Run `pnpm test:e2e:live` against this checkout (it is non-production by design) for the same SHA, and file the output.
8. **Cutover (parent, separately authorized deployment tools).** Point the tunnel ingress for `pocketqa.optijara.ai` from the preview gate's port to the front door's port. **Leave the preview processes running**; they are the rollback.
9. **Post-cutover checks** (from outside):
   - the page has the production CSP and no gate cookie;
   - sign-up, sign-in and sign-out for a real verified address the operator owns;
   - one upload and one playback by that operator;
   - `/api/health` gives 200.
   
   Record them in `docs/verification.md`.

## Rollback

- **Fast (seconds).** The parent points the tunnel ingress back to the preview gate's port. Because `index.html` is `no-store`, the next load gets the preview.
- **Production data is untouched by a rollback:** the data dir, the Firebase users and the R2 objects stay. Nothing is deleted.
- **Code rollback.** Check out the previous reviewed SHA in the production tree, re-run `build-web.sh`, then `launchctl kickstart -k` both units. Database migrations are forward-only (runbook §6), so take a backup (`run-api.sh backup`) before any upgrade, and restore it only with the runbook §5 drill, which includes re-applying deletions.
- **Abort criteria during step 9:** any 5xx from `/api/health`, any CSP violation, any sign-in or upload failure, or any sign of demo data or test credits in production.

## 4. Gates for a live web cutover

| Gate | Owner | State |
|---|---|---|
| Web E2E on real Firebase and R2 from the production origin (I3 web part, S4 web part) | lead | ✅ §1, for the SHA named in `docs/reviews/production/web-launch/e2e-live.txt` |
| Front door with production CSP | lead | ✅ pqa-qa web-launch r1–r3 APPROVE (`184e0a2`) |
| **A5: R2 deletion policy** | Hamza | ✅ Decided 2026-10-04: scoped deletion (see Status). Enforced by the ownership registry plus a prefix check in the R2 adapter (`apps/api/test/storage.test.ts`). Live: `docs/reviews/production/live/r2-scoped-delete.txt` (only the run's 3 objects deleted; the other 26 identical before and after). The production start smoke passes. **Implementation: awaiting pqa-qa review** (`docs/reviews/production/scoped-delete/`) |
| Backup retention, and re-applying deletions after a restore | Hamza | ⬜ Not part of this decision, and untouched. Backups are never pruned automatically (runbook §5) |
| **A9: study funding without payments** (unpaid studies, or no publishing) | Hamza | ⛔ Production builders can't publish |
| Firebase project state | Hamza (console) | ⚠️ Auth reports `subtype IDENTITY_PLATFORM` after the CLI auth deploy (see below), and the billing or plan state is unverified |
| A7 production host and supervisor install | parent | ⬜ |
| B4 privacy policy and terms on the origin | Hamza | ⬜ |
| Real-inbox check of verification and reset links (I5) | operator | ⬜ It belongs in cutover step 9 |
| Wallet login (A8, W4, W5) | Hamza | Off. Not needed for web launch |

**Firebase project state** (the IDENTITY_PLATFORM row above):
- **Billing could not be read from here.** A read-only Cloud Billing GET using the Firebase CLI login was **denied by this session's permission system**, and was not retried by any other route. The Admin SDK service account gets 403 because the Cloud Billing API is not enabled in the project, and enabling it is not authorized.
- **Hamza:** check Firebase console → Usage and billing (plan), and Authentication → Settings (whether Identity Platform is on). No API was enabled and no billing was changed.

## 5. Separate from web acceptance

| Area | Status |
|---|---|
| Android or Seeker on a physical device, and the exact signed binary (N1, N2, S6) | Emulator evidence only. Physical device and release signing are open (A6) |
| iOS (managed sign-in persistence, Keychain size) | Simulator evidence only |
| Real wallets (W5 browser extension, W6 MWA on a device) | Only test and mock wallets so far |
| Store signing and submission (N4) | Not authorized |
| Payments, payouts, mainnet, billing (B2) | Not authorized |
