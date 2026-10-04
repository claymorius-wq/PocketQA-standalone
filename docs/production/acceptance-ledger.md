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
| I2 | Firebase Auth initialised in `pocketqa-optijara` (Email/Password; Google optional; enumeration protection on) | P | ⛔ A1 | getProjectConfig → `CONFIGURATION_NOT_FOUND` at 2026-10-04T09:18:20Z | H-relayed |
| I3 | Real sign-up → verification email → verified sign-in → account → logout revokes (live test against the dedicated project) | P | ⛔ A1, A2 | `test-live/firebase.live.test.ts` is ready | H-relayed |
| I4 | Password reset and verification resend in the app, with copy that doesn't reveal whether an account exists | C | 🔧 | App reset and resend with enumeration-safe copy: `e2e-firebase/firebase-auth.spec.ts` (Auth emulator, 4/4), `__tests__/firebase-errors.test.ts` (inc2)
| I5 | Password reset email received and the reset works (real inbox) | P | ⛔ A1 | | H-relayed |
| I6 | Dedicated service identity `pocketqa-api@` with `roles/firebaseauth.admin` only; no personal tokens | P | ⛔ A2 | | H-direct (no personal tokens) |
| I7 | Production admin provisioning without public identities: `admin:grant` CLI for a verified Firebase user, audited, with no HTTP route | C | 🔧 | `apps/api/test/admin-grant.test.ts`; `scripts/grant-admin.ts` (inc2)
| I8 | Native (Android) Firebase session persistence | C/H | 🔧 emulator | Keystore-backed RN persistence: Maestro `firebase-persistence.yaml` on the **emulator** (green passes; a red build with `getAuth` fails at relaunch). A physical device is still a hardware gate (N2) (inc2)
| I9 | Native Google sign-in (needs the native SDK and release SHA fingerprints) | H | ⛔ A6 | | H-relayed |
| I10 | Authorization: users can't access each other's studies or media; forged, expired and revoked tokens fail; roles can't be escalated | C | ✅ | API suite (authorization matrix, identity tests) in PR #2 | H-direct |

## Evidence storage

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| S1 | Private bucket `pocketqa-evidence`: presign, signed headers, ETag pin, anonymous GET refused | P | ✅ | PR #2 `live/r2-live-test.txt` (5/5, create-only) | H-direct |
| S2 | Bucket-scoped runtime token, not account-wide credentials | P | ⛔ A3 | | H-direct |
| S3 | Exact-origin CORS on `pocketqa-evidence` (PUT from the production origin only, no wildcard) | P | ⛔ A4 | `GetBucketCors` → `NoSuchCORSConfiguration`; the script is prepared, dry-run by default | H-relayed |
| S4 | Browser direct upload and playback with seeking against real R2 from the production origin | P | ⛔ A3, A4 | | H-relayed |
| S5 | **Real-user deletion policy.** Production plus r2 refuses to start until this is decided, because `ALLOW_DELETE=1` is prohibited and `RETAIN_NONPROD` is refused in production. | B | ⛔ A5 | | **open**: R2 deletion prohibited (H-direct) |
| S6 | Real consented recording uploaded from Android (physical device) | H | ⛔ A6 | | H-direct |
| S7 | Interrupted upload resumes (multipart/resumable) | C | ⬜ | Known follow-up; single PUT up to 100 MB today | plan |

## Wallet

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| W1 | Web wallet chooser (several Wallet Standard wallets), `solana:signIn` only | C | ⬜ | | H-relayed |
| W2 | Web connect, login, link and unlink; the last sign-in method stays protected | C | ⬜ | | H-relayed |
| W3 | Android MWA login (sign-in payload), with an explicit domain-binding design per client surface | C | ⬜ | | H-relayed |
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
| D5 | The demo preview (`scripts/preview/*`) still works unchanged as an isolated fixture | C | ⬜ | | H-relayed |

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
| O1 | Health and readiness endpoints | C | ⬜ | | plan |
| O2 | SQLite online backup, restore script and a tested restore drill | C | ⬜ | | plan |
| O3 | Migrations run once and are idempotent on restart (existing) | C | ✅ | `db.ts` migrations, PR #2 | plan |
| O4 | Process supervision and restart recovery (launchd unit plus runbook) | C/H | ⬜ | Host decision A7 | plan |
| O5 | Real TLS endpoint; the native app refuses http or loopback API URLs in production builds | C/P | 🔧 code | The app refuses non-https or loopback APIs in production builds; Android has no cleartext in production. Real TLS waits on host A7. | H-relayed |
| O6 | Rate limits (wallet login, login, uploads), in-process with a single instance documented | C | ✅ partly | PR #2 | plan |
| O7 | Audit log for admin, moderation and role changes, including `admin:grant` | C | ⬜ | | plan |
| O8 | Redacted logs: no tokens, keys or emails in logs | C | ⬜ | | plan |
| O9 | Production data dir separate from the demo (`preview-data`) | C | 🔧 | `production-config.test.ts` (data dir must be outside the repo) (inc1)

## Native and release

| ID | Gate | Class | Status | Evidence or blocker | Authorization |
|---|---|---|---|---|---|
| N1 | Android release build with the production API URL (https), cleartext off | C | ⬜ | | H-relayed |
| N2 | Exact binary installed and tested on a physical Android or Seeker device (labelled physical, not simulator) | H | ⛔ A6 | | H-relayed |
| N3 | iOS: graceful capability differences (no MWA claim) | C | ✅ | PR #1 | plan |
| N4 | Store signing and submission | H/B | not authorised | No store submission for this build | prohibited |

## Residual risks and open notes (from reviews)
- **Admin accounts (inc2 review P3-3).** `admin:grant` trusts the verified identity behind the email. The operator must confirm the person out of band before granting. Admins should use Google sign-in with 2-step verification. Admin MFA in Pocket QA itself needs Identity Platform (billing, not approved), so **admin MFA is a residual risk**.
- **Keystore value size (inc2 review P3-2).** Firebase's persisted user JSON is typically over 2 KB. Android's keystore-backed `expo-secure-store` handled it (emulator proof). iOS Keychain may reject values over 2048 bytes, so **iOS managed sign-in stays an open gate**, with chunking as the fix if iOS becomes a target.
- **Native proof scope (inc2 review P3-4).** I8 was proven with a **development prebuild on an emulator**. A production prebuild (`EXPO_PUBLIC_POCKETQA_ENV=production`) on a physical Android or Seeker device stays open under N1 and N2.
