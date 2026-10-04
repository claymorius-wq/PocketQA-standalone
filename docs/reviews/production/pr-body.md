## Production readiness: production mode, account recovery, wallet UX and operations

Base `9461db5` (`main` after PR #2). This implements every **code** gate in `docs/production/acceptance-ledger.md` that can close locally. pqa-qa reviewed each increment read-only, and all P0–P2 findings are fixed.

**Pocket QA is not production-ready yet.** Production **can't start** until Hamza decides:
- **A5, real-user deletion policy:** production requires `POCKETQA_R2_ALLOW_DELETE=1`, which stays prohibited.
- **A9, study funding without payments.**

The real-provider, hardware and store gates below are also open. The live demo preview is untouched.

### Increments
| Commit | Scope | Review |
|---|---|---|
| `a350118` | **Production mode** (`POCKETQA_ENV=production`). It refuses local auth, the shared demo, emulators and `demo-` projects. It also refuses local media, R2 test endpoints and retention-only R2, any non-https or non-public origin, and a data dir inside the repo. Wallet login is refused without the recorded A8 acceptance. Real providers without an explicit `POCKETQA_ENV` refuse to start. Contract v0.5.0: `features` and `FEATURE_UNAVAILABLE`. In production, test-credit top-ups and devnet transfers are refused server-side and hidden in the app. A production app build refuses demo flags and non-public API URLs, and production Android builds allow no cleartext. `scripts/production/build-web.sh`; Node engine check in `verify` | r1 CHANGES_REQUIRED (P2: unset env failed open), then r2 APPROVE; P3 follow-ups applied after review, covered by `freeze-verdict-qa-r1` |
| `90a5ddd` | **`admin:grant`** (host CLI: a verified managed identity on a dedicated account, audited; no HTTP route). **Password reset and verification resend** (same answer whether or not the account exists). **Native Firebase session in the OS keystore** | r1 APPROVE; P3 follow-ups applied after review, covered by `freeze-verdict-qa-r1` |
| `16378f4` | **Wallets.** The web chooser offers one button per Wallet Standard wallet, and every flow disconnects afterwards. **Android MWA sign-in**: an `mwa` challenge bound to the app identity, one MWA session, exact server text, no transactions. Sign-in errors never use transaction wording | r1 APPROVE; P3 follow-ups applied after review, covered by `freeze-verdict-qa-r1` |
| `4028884` | **Operations.** Online read-only backup and a restore drill that refuses while the API runs and never deletes. Clean SIGTERM shutdown and restart. `/health` checks the DB. Loopback-only proxy trust. Supervisor wrapper (literal, allowlisted env file) and launchd templates; `docs/deploy/production-runbook.md`. A production build that can't reach the API shows an honest "Can't reach Pocket QA" | r1 APPROVE, then r2 APPROVE; P3 follow-ups applied after review, covered by `freeze-verdict-qa-r1` |
| (freeze) | Docs: ledger, verification, progress, this body. `admin:grant` never migrates a live DB. S7 recorded as blocked on A5 | `freeze-verdict-qa-r1` APPROVE (whole branch `9461db5..HEAD`) |

### Integrated release candidate (after `06c09b3`)
- **`94774d1`: merge of `main` `4bd307a`** (Lens UI, PRs #3 and #4). Lens is kept, with the production behaviour re-applied on its screens.
- **Increment 5:**
  - six Lens follow-up UI defects;
  - a `user.deleted` audit row and the `db:deleted-since` tool;
  - the exact-origin CORS tool, now **applied** to `pocketqa-evidence` for `https://pocketqa.optijara.ai` (PUT only, readback and preflight verified, no object touched).
- **Native defects found by the first native run of Lens, all fixed at the root with regression guards:**
  - a recording-start worklet crash;
  - a crash on sign-out and account deletion (a redirect loop);
  - a decline notice that was never visible;
  - on iOS, the password field covered by the riding Sign-in button.
- **pqa-qa interim API findings:** P2-1 (crash-safe restore naming) and P2-2 (restore over a corrupt live database) are fixed and tested.
- **Native evidence is emulator and simulator only:**
  - Android AVD `Medium_Phone_API_36.1`; iOS simulator iPhone 17 Pro, iOS 26.4;
  - **wallet tests use test wallets only:** a Wallet Standard test wallet in Playwright, and Solana's mock MWA wallet on the emulator.
  
  No physical device and no real wallet were used.

### Evidence (details: `docs/verification.md`, 2026-10-04 production section)
- **`pnpm verify`:** EXIT=0. Test counts: scripts 47, contracts 17, domain 170, API 369 plus 2 skipped, mobile 731.
- **Playwright:** 12/12.
- **Firebase Auth emulator E2E:** 4/4.
- **Production web export:** clean.
- **Native, EMULATOR ONLY:**
  - keystore session survives kill and relaunch (green); the old memory-only build fails (red);
  - MWA wallet sign-in and decline with Solana's mock wallet;
  - the production prebuild has no cleartext and no loopback or demo strings.
- **Read-only probes:** Firebase Auth `CONFIGURATION_NOT_FOUND` (09:18, 09:45 and 10:22Z); the bucket has no CORS.

### Gates still open (`docs/production/acceptance-ledger.md`)
- **Real provider:**
  - live Firebase sign-up, reset and verification (I2, I3, I5);
  - the dedicated service account (I6);
  - a bucket-scoped R2 token (S2);
  - exact-origin CORS (S3);
  - real browser upload and playback (S4).
- **Hardware and store** (none of this has been run on real hardware or a real wallet):
  - a physical Android or Seeker device with the exact binary (N2);
  - release signing (A6);
  - native Google sign-in (I9);
  - a real browser wallet (W5) and a real MWA wallet on a device (W6);
  - the physical recording upload (S6).
- **Business:**
  - deletion policy, including backup retention and re-deletion after a restore (A5);
  - funding (A9 / B1);
  - wallet-login risk acceptance (A8 / W4);
  - privacy policy and terms (B4).
- **Blocked by the no-deletion rule:** resumable or multipart uploads (S7). Abort deletes parts.
- **Residual risks recorded:**
  - admin MFA (needs Identity Platform, which needs billing);
  - the MWA identity `pocketqa.local` is an unverifiable placeholder;
  - iOS keystore value size for managed sign-in.

### Access actions needed (`docs/production/parent-access-actions.md`)
- **A1:** Firebase console: Auth "Get started" and Email/Password.
- **A1+:** enumeration protection.
- **A2:** service account `pocketqa-api@` with `roles/firebaseauth.admin`; a key file path only.
- **A3:** an R2 token limited to `pocketqa-evidence`.
- **A4:** confirm the production origin; then CORS (PUT only) and the Firebase authorized domain.
- **A5:** the deletion policy.
- **A6:** Android signing fingerprints and a physical device.
- **A7:** the host.
- **A8:** Hamza's own wording accepting both wallet residual risks.
- **A9:** funding.

### Cutover (later, parent; not part of this PR)
Install from the exact reviewed SHA following the runbook, once A1–A5 and A7 are done. The demo preview keeps running from its own scripts and data.

### Process disclosure
Outside the team rules (no hidden advisor and no subagents), the lead used the in-session advisor tool several times this session. The lead also briefly started one read-only Explore subagent, which was stopped before it returned anything. Both are recorded in `docs/progress.md` and have stopped. pqa-qa reviewed every committed change independently and re-ran the gates.

**Do not merge** until the parent verifies.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
