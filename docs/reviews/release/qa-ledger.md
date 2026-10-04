# Production release: independent QA evidence ledger (pqa-qa, pane wX:p2)

I own this file. The lead may commit it as is but shouldn't edit it.

## Basics
- **Base:** `main` at `9461db5`.
- **Worktree:** `.worktrees/production-readiness`, branch `feat/production-readiness`.
- **Started:** 2026-10-04.
- **Reviewer rules:**
  - No cloud mutation of any kind: no R2 writes, deletes or config changes, and no Firebase or IAM changes.
  - The existing demo stays live until the parent's verified cutover.
  - I don't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.
  - Every P0, P1 or P2 blocks.
  - "Verified" means I ran an executable flow myself (a test, E2E run or real server). Reading the source alone counts only as "source-checked".

## Acceptance criteria (parent, 2026-10-04) and status

The criteria are A1–A10. Status values are open, source-checked, verified, gated or blocked. "Gated" means the step needs real hardware or real provider credentials and can't be faked.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| A1 | Real auth (Firebase) in production mode; no local password path | open | Auth still returns `CONFIGURATION_NOT_FOUND`. A live sign-in is **gated** on Hamza's console step. |
| A2 | Private R2 evidence storage, pinned to `pocketqa-evidence` | open | — |
| A3 | No shared-demo shortcuts or test top-ups in production | open | B1 |
| A4 | Full wallet UX: connect, link, sign in, disconnect and errors, on web and Android MWA | open | A real wallet or Seeker is **gated** on hardware. |
| A5 | Native session persistence across app restarts | open | B2 |
| A6 | Safe account lifecycle: sign-up, verify, sign-in, logout revocation, export, delete fails closed without deletion approval | open | — |
| A7 | Restart safety and backup or restore of the DB | open | B3 |
| A8 | No unsupported payment or AI claims: test credits and devnet only; AI shown as unavailable | open | — |
| A9 | No R2 deletion or lifecycle without policy approval; other buckets untouched | open | Carried over from `safety-verdict-qa-r2` (deletion refused, bucket pinned). Must be re-verified on each candidate. |
| A10 | Existing demo untouched until the parent's cutover | open | — |

## Baseline gaps on `main` 9461db5 (source-checked; for the lead to plan)
- **B1 (A3): test top-ups have no gate.**
  - `apps/api/src/handlers/account.ts:201-205` lets any builder mint test credits, and `CreditsScreen.tsx:56` exposes the button.
  - Production mode needs this route refused server-side (not only hidden in the UI) and covered by a test.
- **B2 (A5): native Firebase persistence.**
  - `apps/mobile/src/auth/firebaseClient.ts:33` uses `getAuth(app)` on native.
  - In the Firebase JS SDK on React Native, that is memory-only unless `initializeAuth(app, { persistence: getReactNativePersistence(...) })` is used. Sessions would then be lost on app restart.
  - This has to be verified by killing and relaunching on a device or emulator, not from the source.
- **B3 (A7): no backup or restore path.** There is nothing in `apps/api/src` or `scripts/`. SQLite needs a consistent online backup (`.backup()` or `VACUUM INTO`), a restore drill, and a restart test that covers the deletion outbox and the sweep.
- **B4 (A3): the shared demo is isolated by `POCKETQA_SHARED_DEMO` and `scripts/preview/start.sh`.**
  - Production must refuse `SHARED_DEMO`, demo sign-ins and the convenience file.
  - It also needs proof that the live preview is untouched (A10).

## Candidate reviews
| Round | Candidate (commit or tree) | Verdict | File |
|---|---|---|---|
| inc1 r1 | staged set, 30 files, base `9461db5` | CHANGES_REQUIRED: P2-1, an unset `POCKETQA_ENV` fails open to development (test top-ups on, with real providers) | `docs/reviews/production/inc1-verdict-qa-r1.md` |
| inc1 r2 | staged set, 39 files, base `9461db5` | APPROVE. P2-1 is fixed and verified. New P3s: `check-url.mjs` exits 0 without checking when invoked through a symlink or a path with spaces; document explicit development mode | `docs/reviews/production/inc1-verdict-qa-r2.md` |
| inc2 r1 | staged set, 30 files, base `a350118` | APPROVE. P3s: an abandoned unverified Firebase session persists; keystore value size; admin MFA is procedural; native proof is emulator and development only | `docs/reviews/production/inc2-verdict-qa-r1.md` |
| inc3 r1 | staged set, 36 files, base `90a5ddd` | APPROVE. P3s: the `pocketqa.local` MWA identity can't be verified (broken icon, no Digital Asset Links); transaction wording on login errors; the MWA statement lacks "only sign in the app"; Android firebase mode, W5 and W6 untested | `docs/reviews/production/inc3-verdict-qa-r1.md` |
| inc4 r1 | staged set, 20 files, base `16378f4` | APPROVE. P3s: backups keep deleted accounts and a restore undoes deletions (fold into A5); `db:backup` runs migrations on the live DB; the restore relies on a port probe; the env file is sourced as shell; the backup dir symlink isn't resolved | `docs/reviews/production/inc4-verdict-qa-r1.md` |
| inc4 r2 | staged set, 28 files, base `16378f4` | APPROVE. The r1 P3s are fixed. New P3s: the runbook env example's inline comments break the literal parser (fails closed); no unit test for "unreachable"; optional key allowlist | `docs/reviews/production/inc4-verdict-qa-r2.md` |
| freeze r1 | `9461db5..4028884` plus the staged freeze set | APPROVE. My A1–A10 reconcile with the acceptance ledger with no contradictions. P3s: PR body wording; carry the lead's advisor and subagent disclosure into the PR; close out the 🔧 statuses | `docs/reviews/production/freeze-verdict-qa-r1.md` |

### freeze r1: executable evidence (freeze tree, Node 24.21.0)
- **`pnpm verify`:** EXIT=0. Secrets 624; scripts 47; contracts 17; domain 170; API 369 plus 2 skipped; mobile 731.
- **Playwright:** 12/12. Screenshots restored.
- **`pnpm test:e2e:firebase`:** 4/4.
- **`build-web.sh /api`:** EXIT=0, secrets 0/29.
- **`git diff 9461db5 HEAD -- scripts/preview`:** empty (A10).
- **Branch grep:** no added R2 delete or bucket-config path (A9).

### Final status (freeze)
- **Verified locally:** A3, A6 (code), A7 (local), A8, A10.
- **Verified on an emulator only:** A4 (web and MWA, mock wallet) and A5.
- **Gated:**
  - A1: live Firebase, waiting on access actions A1 and A2;
  - A2: the token, CORS and browser upload, waiting on A3 and A4;
  - A4: real wallets, physical device and A8;
  - A5: physical device;
  - A7: production host;
  - A9: Hamza's deletion policy (access action A5).

### inc4 r2: executable evidence
- **`pnpm verify` with Node 24.21.0:** EXIT=0. Secrets 620 files; scripts 45; contracts 17; domain 170; API 369 plus 2 skipped; mobile 729.
- **The parser loop on a scratch file:** inline comments are kept in the values (P3-1).
- **Production APK launch screenshot:** inspected. It shows "Can't reach Pocket QA" and no local sign-in form.

### inc4 r1: executable evidence
- **`pnpm verify` with Node 24.21.0:** EXIT=0. Secrets 616 files; scripts 44; contracts 17; domain 170; API 368 plus 2 skipped; mobile 729.
- **My own real-process drill** (temp dir, port 18947):
  - a live backup at 0600;
  - restore refused while the API runs;
  - SIGTERM exits 0 and the WAL is checkpointed;
  - restore kept a `.pre-restore` copy;
  - after restart, an account from before the backup logs in and one created after it gets 401;
  - a second SIGTERM exits 0.
- **`plutil -lint`:** both plists OK.
- **A7 (restart and backup):** verified locally. The production host install and its drill remain gated on access action A7.

### inc3 r1: executable evidence
- **`pnpm verify` with Node 24.21.0:** EXIT=0. Secrets 603 files; scripts 42; contracts 17; domain 170; API 360 plus 2 skipped; mobile 728.
- **Playwright:** 12/12, PW_EXIT=0, including the two-wallet chooser. Screenshots restored.
- **MWA native artifacts:** inspected, not rerun (shared emulator). The login reaches Discover; a decline shows "not signed in"; the wallet shows the exact server text.
- **A4 (wallet UX):** web and Android flows verified on an emulator and in Playwright. Real wallets and A8 remain gated.

### inc2 r1: executable evidence
- **`pnpm verify` with Node 24.21.0:** EXIT=0. Secrets 585 files; scripts 42; contracts 17; domain 170; API 358 plus 2 skipped; mobile 721.
- **`pnpm test:e2e:firebase`** (local Auth emulator): 4/4, EXIT=0, covering resend and enumeration-safe reset.
- **Native persistence (B2):** I inspected the artifacts (the green flow passes after a kill and relaunch; the red memory-only build fails at relaunch). I didn't rerun it, because the emulator is shared.
  - B2 is now **verified on an emulator, in a development prebuild**.
  - A physical device and a production prebuild remain open.

### inc1 r2: executable evidence
- **`pnpm verify` with Node 24.21.0:** EXIT=0. Secrets 564 files; scripts 41; contracts 17; domain 170; API 355 plus 2 skipped; mobile 714.
- **`check-node.mjs` with Node 25.4:** exit 1, as intended.
- **`loadConfig` probe:**
  - an unset env with real Firebase or real R2 is refused;
  - every loopback or private spelling of the production origin is refused;
  - a public origin loads, with production on and both test features off.
- **`build-web.sh`:**
  - bad `PROD_WEB_DIR` values exit 1;
  - loopback and private API URLs are refused;
  - `/api` builds with EXIT=0, secrets 0/29;
  - the `check-url.mjs` guard exits 0 when invoked through a symlink (P3).

## Status after inc1 r1 (A3 and A9 unblocked by r2)
- **A3** is source-checked and partly verified. The `topUp` and devnet refusals pass their tests and the production web bundle has no demo code. It stays **blocked by P2-1**.
- **A9** is source-checked: the bucket pin and deletion guard are intact, and production requires `ALLOW_DELETE=1`. It is also **blocked by P2-1**, since the `RETAIN_NONPROD` path is open when the env is unset.
- **A10:** `scripts/preview/*` isn't in the diff.
- **B1** is fixed, subject to P2-1. B2 and B3 are still open.

## Executable evidence I ran
- **inc1 r1, `pnpm verify` with Node v24.21.0:** EXIT=0. Secrets 561 files; script tests 39; contracts 15; domain 170; API 354 plus 2 skipped; mobile 714.
- **The same run with Node 25.4:** EXIT=1. The `glass` grain test differs by Node version, so this is an environment issue.
- **inc1 r1, `PROD_API_URL=/api bash scripts/production/build-web.sh`:** EXIT=0. Secret check 0/29; `PREVIEW_BUILD` is inlined as `!1`.
- **inc1 r1, the `loadConfig` probe** (a temporary tsx script, removed afterwards):
  - an unset env loads `production:false` with test features on, even with real providers;
  - `https://localhost` is accepted as the production origin;
  - emulator hosts are refused.
