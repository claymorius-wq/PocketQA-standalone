# Production acceptance ledger

**Base:** `9461db5` (`origin/main` after PR #2). **Branch:** `feat/production-readiness`.

**Sources:**
- `docs/plans/backend-cloud-auth-wallet-plan.md`, Phases 1–5 and "Verification and rollout".
- Hamza's production authorization, relayed by the parent on 2026-10-04.
- ADR 0005.

**Numbering:** this ledger's IDs (I, S, W, D, B, O, N) and the access actions A1–A9 in `parent-access-actions.md` are separate from pqa-qa's acceptance criteria A1–A10 in `docs/reviews/release/qa-ledger.md`.

**Rule:** Pocket QA is **not** production-ready until every row is ✅. Each row has one class:

| Class | Meaning |
|---|---|
| **C** | Code: closable here, by tests plus a pqa-qa verdict. |
| **P** | Real-provider integration: needs live Firebase or R2 evidence against the dedicated resources. |
| **H** | Physical hardware or store: needs a real device, a signed binary, or a store. Simulator proof is labelled as such. |
| **B** | Business or authorization decision by Hamza. It can't be closed by code. |

**Status:**

| Mark | Meaning |
|---|---|
| ⬜ | Open. |
| 🔧 | Code done, awaiting review or provider evidence. |
| ✅ | Closed, with evidence. |
| ⛔ | Blocked on a named access action from `parent-access-actions.md`. |

**Authorization column:**
- **H-direct:** Hamza's own recorded words in an earlier session.
- **H-relayed:** this production request, relayed by the parent.
- **open:** no authorization recorded.

## Identity and accounts

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| I1 | Production config refuses local password auth, shared demo, emulator hosts and non-prod R2 retention | C | 🔧 | `apps/api/test/production-config.test.ts` (inc1)
| I2 | Firebase Auth initialised in `pocketqa-optijara` (Email/Password; Google optional; enumeration protection on) | P | ⛔ A1 | getProjectConfig → `CONFIGURATION_NOT_FOUND` at 09:18:20Z, 09:45:42Z, 10:22:53Z and 13:01:31Z (2026-10-04). Only one Firebase app exists ("Pocket QA Web") | H-relayed |
| I3 | Real sign-up → verification email → verified sign-in → account → logout revokes (live test against the dedicated project) | P | ⛔ A1, A2 | `test-live/firebase.live.test.ts` is ready | H-relayed |
| I4 | Password reset and verification resend in the app, with copy that doesn't reveal whether an account exists | C | 🔧 | App reset and resend with enumeration-safe copy: `e2e-firebase/firebase-auth.spec.ts` (Auth emulator, 4/4), `__tests__/firebase-errors.test.ts` (inc2)
| I5 | Password reset email received and the reset works (real inbox) | P | ⛔ A1 | | H-relayed |
| I6 | Dedicated service identity `pocketqa-api@` with `roles/firebaseauth.admin` only; no personal tokens | P | ⛔ A2 | | H-direct (no personal tokens) |
| I7 | Production admin provisioning without public identities: `admin:grant` CLI for a verified Firebase user, audited, with no HTTP route | C | 🔧 | `apps/api/test/admin-grant.test.ts`; `scripts/grant-admin.ts` (inc2)
| I8 | Native (Android) Firebase session persistence | C/H | 🔧 emulator | Re-run on the Lens build (**emulator**, development prebuild): the session survives force-stop and relaunch. Physical device and production prebuild still open
| I9 | Native Google sign-in (needs the native SDK and release SHA fingerprints) | H | ⛔ A6 | | H-relayed |
| I10 | Authorization: users can't access each other's studies or media; forged, expired and revoked tokens fail; roles can't be escalated | C | ✅ | API suite (authorization matrix, identity tests) in PR #2 | H-direct |

## Evidence storage

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| S1 | Private bucket `pocketqa-evidence`: presign, signed headers, ETag pin, anonymous GET refused | P | ✅ | PR #2 `live/r2-live-test.txt` (5/5, create-only) | H-direct |
| S2 | Bucket-scoped runtime token, not account-wide credentials | P | ⛔ A3 | | H-direct |
| S3 | Exact-origin CORS on `pocketqa-evidence` (PUT from the production origin only, no wildcard) | P | ✅ | Applied on `pocketqa-evidence` only: one rule, PUT from `https://pocketqa.optijara.ai` with header `content-type`. Readback matches. Preflight: PUT from the origin gives 204; another origin gives 403; GET gives 403 (`docs/reviews/production/r2-cors-apply.txt`). No object touched | H-relayed |
| S4 | Browser direct upload and playback with seeking against real R2 from the production origin | P | ✅ web | `pnpm test:e2e:live`: production web build behind the production front door, loaded as `https://pocketqa.optijara.ai`. The browser PUT to R2 gives 200 under the exact-origin CORS rule, playback gives 206 with `Content-Range`, and a seek to 2 s works (a mid-file range gives 206 for the exact bytes). There are 0 CSP violations. Real Firebase and R2, non-production API, synthetic data (`docs/production/web-launch.md` §1). A3 is accepted per Hamza (existing account-wide keys) | H-relayed |
| S5 | **Real-user deletion policy.** Production plus r2 refuses to start until this is decided, because `ALLOW_DELETE=1` is prohibited and `RETAIN_NONPROD` is refused in production. | B | ⛔ A5 | | **open**: R2 deletion prohibited (H-direct) |
| S6 | Real consented recording uploaded from Android (physical device) | H | ⛔ A6 | | H-direct |
| S7 | Interrupted upload resumes (multipart/resumable) | C/B | ⛔ A5 | Blocked by the no-deletion rule. R2 multipart needs `AbortMultipartUpload` for abandoned uploads, and abort deletes the uploaded parts, which is R2 deletion. The lifecycle backstop was withdrawn. Without abort, abandoned uploads leave billed orphan parts forever. Build it only after A5, with abort routed through the `allowDelete`/outbox gate, after a design review. Single PUT up to 100 MB today | plan |

## Wallet

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| W1 | Web wallet chooser (several Wallet Standard wallets), `solana:signIn` only | C | 🔧 | One button per installed Wallet Standard wallet, for login and linking. The chosen wallet signs, and it is disconnected after every flow: `e2e/wallet-login.spec.ts` "wallet chooser" (inc3)
| W2 | Web connect, login, link and unlink; the last sign-in method stays protected | C | 🔧 | Web connect, `solana:signIn` login, link and unlink, with the last sign-in method protected (E2E, inc3). Disconnect via `standard:disconnect`
| W3 | Android MWA login (sign-in payload), with an explicit domain-binding design per client surface | C | 🔧 emulator | Re-run on the Lens build with the Solana **mock** wallet on the **emulator**: MWA sign-in and decline both pass. No real wallet and no physical device (W6 still open)
| W4 | Wallet login enabled in production only after Hamza's explicit acceptance of the residual raw-`signMessage` phishing risk is recorded in ADR 0005 §2 | B | ⛔ A8 | | **open** |
| W5 | Real browser wallet (Phantom/Solflare extension) sign-in on the production origin; a wrong origin is refused or warned | H | ⬜ | | H-relayed |
| W6 | Real-device MWA login and link with a devnet wallet (physical) | H | ⛔ A6 | Earlier MWA linking evidence exists (PR #1 era) | H-relayed |

## Demo removal (from production reach; fixtures preserved)

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| D1 | No shared prefilled accounts or gate in production builds (the `EXPO_PUBLIC_PREVIEW` build refuses production) | C | 🔧 | `apps/mobile/__tests__/deployment.test.ts`, `scripts/production-scripts.test.mjs`, the production web export (inc1)
| D2 | No demo seeding or public admin identity reachable in production | C | 🔧 | Production refuses local auth, so the demo seed's `/auth/register` is refused, and `admin:create` refuses non-local auth: `apps/api/test/admin-scripts.test.ts` (inc1)
| D3 | Test-credit top-up unavailable in production: an honest error and the UI hides it, with no fake success | C | 🔧 | `apps/api/test/production-features.test.ts`; Credits screen notice (inc1)
| D4 | Devnet demo transfer is not offered in production (devnet only, clearly labelled) | C | 🔧 | `production-features.test.ts`; transfer cards hidden (inc1)
| D5 | The demo preview (`scripts/preview/*`) still works unchanged as an isolated fixture | C | ✅ | `scripts/preview/*` is unchanged on this branch. `preview-scripts.test.mjs` and `preview-gate.test.mjs` pass in every `pnpm verify`, and pqa-qa checked its A10 in every round

## Financial and product (business)

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| B1 | **Study funding in production.** `rewardCredits` must be positive, and credits come only from the test top-up, so production builders **can't publish** until Hamza chooses: unpaid studies (reward 0), or no publishing until payments. | B | ⛔ A9 | | **open** |
| B2 | Real compensation, payments, mainnet and custody | B | not authorised | Separate explicit approval required | **prohibited** |
| B3 | AI analysis: unavailable unless a provider is configured, and never fabricated | C | ✅ | `aiStatus` returns unavailable; UI copy | H-direct |
| B4 | Privacy policy and terms published on the production origin | B | ⬜ | | open |

## Operations

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| O1 | Health and readiness endpoints | C | 🔧 | `/health` pings the DB, so it is readiness, not just liveness (`apps/api/test/operations.test.ts`) (inc4)
| O2 | SQLite online backup, restore script and a tested restore drill | C | 🔧 | Online `backup()` producing a self-contained 0600 file with sha256; restore keeps the old files and refuses while the API runs; drill tests `backup.test.ts`, `db-scripts.test.ts`, `operations.test.ts`; runbook §5 (inc4). A host drill is still to be recorded on the production host
| O3 | Migrations run once and are idempotent on restart (existing) | C | ✅ | `db.ts` migrations, PR #2 | plan |
| O4 | Process supervision and restart recovery (launchd unit plus runbook) | C/H | 🔧 code | SIGTERM/SIGINT give a clean shutdown and restart keeps the data (real process test); `scripts/production/run-api.sh` (locked-down env file); `deploy/launchd/*.plist`; runbook §3 (inc4). Installation on the host waits on A7 | plan |
| O5 | Real TLS endpoint; the native app refuses http or loopback API URLs in production builds | C/P | 🔧 code | The app refuses non-https or loopback APIs in production builds; Android has no cleartext in production. Real TLS waits on host A7. | H-relayed |
| O6 | Rate limits (wallet login, login, uploads), in-process with a single instance documented | C | 🔧 | Plus a trusted proxy limited to loopback (production default), so limits are per client behind the tunnel and a forged X-Forwarded-For is ignored without trust (`operations.test.ts`) (inc4) | plan |
| O7 | Audit log for admin, moderation and role changes, including `admin:grant` | C | 🔧 | Disputes, moderation and admin decisions were audited already (PR #2); `admin:grant` adds `user.admin_granted` (inc2)
| O8 | Redacted logs: no tokens, keys or emails in logs | C | 🔧 | Logger serializers record method, redacted path and status only; media tokens and `/__preview` paths are redacted (`apps/api/test/log.redact.test.ts`)
| O9 | Production data dir separate from the demo (`preview-data`) | C | 🔧 | `production-config.test.ts` (data dir must be outside the repo) (inc1)

## Native and release

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| N1 | Android release build with the production API URL (https), cleartext off | C | 🔧 emulator | Production prebuild: no cleartext, https API inlined, no loopback or demo accounts in the bundle; unreachable state honest on the emulator (see notes, inc4). Release signing is still open (A6)
| N2 | Exact binary installed and tested on a physical Android or Seeker device (labelled physical, not simulator) | H | ⛔ A6 | | H-relayed |
| N3 | iOS: graceful capability differences (no MWA claim) | C | ✅ | PR #1 | plan |
| N4 | Store signing and submission | H/B | not authorised | No store submission for this build | prohibited |

## Residual risks and open notes (from reviews)
- **Admin accounts (inc2 review P3-3).** `admin:grant` trusts the verified identity behind the email. The operator must confirm the person out of band before granting. Admins should use Google sign-in with 2-step verification. Admin MFA in Pocket QA itself needs Identity Platform (billing, not approved), so **admin MFA is a residual risk**.
- **Keystore value size (inc2 review P3-2).** Firebase's persisted user JSON is typically over 2 KB. Android's keystore-backed `expo-secure-store` handled it (emulator proof). iOS Keychain may reject values over 2048 bytes, so **iOS managed sign-in stays an open gate**, with chunking as the fix if iOS becomes a target.
- **Native proof scope (inc2 review P3-4).** I8 was proven with a **development prebuild on an emulator**. A production prebuild (`EXPO_PUBLIC_POCKETQA_ENV=production`) on a physical Android or Seeker device stays open under N1 and N2.
- **Wallet login (inc3 review P3-1, P3-4).** The MWA identity `pocketqa.local` is a placeholder and can't be verified. Moving it to an owned domain with `assetlinks.json` is a precondition for W4 and W6. Not yet tested: Android in firebase mode (the custom-token exchange on a device), a real browser wallet (W5), and a physical device with a real wallet (W6).
- **Backups and deletion (inc4 review P3-1).** A restore brings back accounts deleted after the backup was taken. The runbook (§5) requires re-applying those deletions by comparing tombstones. Backup retention, and a tool for re-applying deletions, belong to the A5 decision. Known follow-up: account self-deletion isn't written to the audit log; only the tombstone row remains.
- **N1 evidence (inc4).** A production prebuild (`EXPO_PUBLIC_POCKETQA_ENV=production`, `EXPO_PUBLIC_API_URL=https://api.pocketqa.example` placeholder) gives a network config with **no** cleartext domains, and the manifest references it. The Hermes bundle contains the https API URL, no `127.0.0.1:8787` and no demo accounts. On the **emulator**, with the API unreachable, the app shows "Can't reach Pocket QA" and a retry, never a local-mode form. Release signing (debug key) and a physical device are still open.
- **Increment 5.**
  - Account self-deletion writes a fixed-text `user.deleted` audit row.
  - `db:deleted-since --pre-restore <file>` lists the deletions to re-apply after a restore.
  - Six Lens follow-up UI P3s are fixed (`docs/reviews/lens-followups/verdict-qa-r1.md`):
    - the Credits top-up is bound to the tapped amount;
    - sheet fields lock while sending;
    - New study keyboard focus clears the dock scrim;
    - the disputes and moderation binding tests and the focus-spec items were already on main.
- **Origin (A4) is confirmed:** `https://pocketqa.optijara.ai`. The Firebase authorized domain for it still needs the console (A1/A4).
- **Native runs on the merged Lens build** (Android **emulator** AVD `Medium_Phone_API_36.1` and iOS **simulator** iPhone 17 Pro, iOS 26.4; no physical device). They found and fixed four Lens defects: a worklet crash, a sign-out crash, a hidden decline notice, and the iOS password field covered by the riding Sign in button. Details: `docs/reviews/production/rc-candidate.md` §3.
- **Wallet tests:** every wallet test so far uses **test wallets**:
  - a Wallet Standard test wallet in Playwright;
  - Solana's **mock** MWA wallet on the emulator.
  
  No real browser wallet (W5) and no real wallet on a device (W6) have been tested.
- **Web launch (`docs/production/web-launch.md`).**
  - The real Firebase and R2 browser E2E passes from the production origin (sign-up through approval, role isolation, ranged playback).
  - New production front door `scripts/production/web-server.mjs`, with a CSP that names only Firebase Auth and the R2 endpoint.
  - The live run found and fixed a sign-up defect: a Firebase 503 on the verification email is now reported honestly.
  - Live cutover still waits on A5, A9, the Firebase plan check (console), A7 and B4.
