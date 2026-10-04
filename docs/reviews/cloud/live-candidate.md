# Freeze candidate: cloud activation, live provider verification (R2 verified; Firebase blocked at Auth init)

**Worktree:** `/Users/hamzadiaz/Projects/pocket-qa/.worktrees/cloud-auth-wallet`. **Branch:** `feat/cloud-auth-wallet` over `d15b344` (PR #2, pushed by the parent). Staged, not committed.
**Authorization (parent message, 2026-10-04):**
- dedicated Firebase project `pocketqa-optijara` and dedicated R2 bucket `pocketqa-evidence`, both created by the parent;
- reading credentials from `optijara-website/.env.local` and `reshare/.env.local` is allowed, but values are never printed;
- **hard rule:** no deletion or modification of any R2 bucket or object; new objects only, in `pocketqa-evidence`;
- no billing, no mainnet, no other projects, no live-preview change, no merge.

## What was done
- **Firebase:**
  - confirmed the project is visible (CLI `projects:list`: `pocketqa-optijara`, number 598629357848; no apps before);
  - **created web app "Pocket QA Web"** (`apps:create web`);
  - stored its public SDK config in git-ignored `.cloud-local/firebase-web.json` (0600).
- **Firebase Auth state, read-only:**
  - Identity Toolkit admin config: `CONFIGURATION_NOT_FOUND`;
  - public `createAuthUri`: `CONFIGURATION_NOT_FOUND`;
  - `identitytoolkit.googleapis.com` is enabled, the IAM API is disabled, and billing info isn't readable (403).
  - The API route to initialise Auth (`identityPlatform:initializeAuth`) is Identity Platform, which needs billing, so it was **not** called. The CLI has no Auth-initialise command (checked).
  - `gcloud`: the active account has no access, and the Optijara account needs interactive re-authentication. Nothing was switched globally.
- **Live tests added** (skipped unless their `POCKETQA_LIVE_*` flag is set; they read credentials from the environment only):
  - `apps/api/test-live/r2.live.test.ts` refuses any bucket except `pocketqa-evidence` and wraps the real store so **every delete is intercepted and refused**. It covers:
    - presigned PUT, HEAD and ranged read;
    - signed headers enforced by R2 (length and type);
    - an ETag-pinned copy, and a stale ETag giving 412;
    - an anonymous GET refused;
    - the full API flow (intent, PUT, verified completion, ranged playback, spoofed type rejected).
  - `apps/api/test-live/firebase.live.test.ts` refuses any project but `pocketqa-optijara`. It covers real sign-up, unverified refused, Admin `updateUser(emailVerified)`, account creation, `/me`, and logout revocation. It deletes nothing.
- **Runners** live in the session scratchpad, outside the repo: credentials are loaded in-process and redacted from output. The Firebase runner uses the CLI's authorized login as an `authorized_user` credential in a temporary 0600 file, removed afterwards.
- **Repo:** `.gitignore` adds `.cloud-local/`, and `check-secrets` forbids it (test red, then green). `docs/deploy/cloud-backend.md` has the live status, the ordered remaining user actions and the live-test commands.

## Evidence
- **Live R2:** 5/5 passed (`docs/reviews/cloud/live/r2-live-test.txt`; the output was scanned and contains 0 credential values).
  - A read-only listing shows exactly 5 new synthetic objects (`live/r2-objects-created.md`), and **no deletions**.
  - The two quarantine deletes the app would normally perform were queued in the outbox instead.
- **Live Firebase:** fails today at `accounts:signUp: CONFIGURATION_NOT_FOUND` (Auth not initialised). **No users created.** Output: `live/firebase-live-test.txt`.
- **`pnpm verify`:** EXIT=0 (`live-pnpm-verify.txt`): API 337 plus 8 skipped (emulator and live); mobile 709; contracts 15; domain 170; root 37.
- **Repo scan** for the live credential values (R2 key pair, account id, Firebase web key and app id): 0 occurrences in 539 committable files.

## Unavoidable user actions (after the safe alternatives above were tried)
1. Firebase console → Authentication → **Get started**, then enable Email/Password (free plan).
2. Server Admin credential: enable the IAM API and create a dedicated SA (`roles/firebaseauth.admin`, plus a token creator on itself), or re-authenticate the Optijara `gcloud` account so I can do it.
3. A bucket-scoped R2 token for `pocketqa-evidence`.
4. Approval for the bucket CORS change (browser PUT from the exact origin).
5. A decision on R2 deletion. **Correction (post-approval):** the earlier lifecycle recommendation is withdrawn, because Hamza prohibits R2 deletion. The adapter now refuses deletes by default (see the post-approval safety fixes).
