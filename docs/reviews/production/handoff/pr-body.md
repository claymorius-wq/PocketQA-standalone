# Web launch closure and scoped R2 deletion (A5)

Branch `feat/web-launch-e2e` from `main` `4b48a29`. Every candidate was reviewed by pqa-qa (read-only, Herdr pane `wX:p2`).

## What's in it
1. **Production web front door**, `scripts/production/web-server.mjs`, with tests and a launchd unit.
   - It serves the static production build and proxies `/api` same-origin, with Host pinning.
   - It sets the forwarding headers itself.
   - Its CSP `connect-src` names only Firebase Auth and `https://<acct>.r2.cloudflarestorage.com/pocketqa-evidence/`.
2. **Live real-provider web E2E** (`pnpm test:e2e:live`, opt-in).
   - The production build behind the front door, loaded as `https://pocketqa.optijara.ai` and answered locally.
   - Real Firebase and R2, with a non-production API.
   - Covered: sign-up, verify and sign-in; publish with test credits; consent; browser PUT to R2 (200 under the real CORS rule); completion; 404 role isolation; 206 ranged playback with a seek; approval; 0 CSP violations (the detector is self-tested, and enforcement is negative-controlled).
3. **Sign-up fix.** Firebase can return 503 on the verification email after the account is created. The app now says "Account created, email not sent" instead of a false failure.
4. **Scoped R2 deletion (A5, Hamza 2026-10-04).**
   - The app deletes only objects it created: the `storage_objects` registry, migration 4.
   - Only in `pocketqa-evidence`, only for failed-upload cleanup and account deletion.
   - There is no expiry of evidence, no lifecycle rule and no bulk path; the R2 adapter only issues single-object commands under `evidence/` and `quarantine/`.
   - **Needs confirmation:** removing the quarantine copy of a successful upload (`upload_staging`) is the lead's interpretation.
   - Production mode now starts on the real providers.

## Reviews
- **Web launch:** `docs/reviews/production/web-launch/verdict-qa-r1..r3.md`, APPROVE ×3, final code `184e0a2`.
- **Scoped deletion:** `docs/reviews/production/scoped-delete/verdict-qa-r1.md` (CHANGES_REQUIRED, P2 wording) → `verdict-qa-r2.md` APPROVE of `4fd0071`.

## Evidence
- `docs/reviews/production/web-launch/*.txt`
- `docs/reviews/production/scoped-delete/pnpm-verify.txt`
- `docs/reviews/production/live/{web-live-e2e,r2-scoped-delete,prod-start-smoke}.txt`

All outputs are redacted. The live deletion run shows 26 objects before and 26 after, identical, with only the run's own 3 deleted.

## Not in this PR (no cutover)
**Web launch decisions:**
- A9: funding without payments; production builders can't publish today.
- The `upload_staging` confirmation.
- The Firebase plan and Identity Platform console check (billing unverified).
- A7: host and supervisor install.
- B4: privacy policy and terms.
- A real-inbox check at cutover.
- Backup retention.

**Native roadmap (separate):** a physical Android or Seeker device, release signing, iOS managed sign-in, real wallets (W5, W6) and wallet-login risk acceptance (A8). Store submission and payments are not authorized.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
