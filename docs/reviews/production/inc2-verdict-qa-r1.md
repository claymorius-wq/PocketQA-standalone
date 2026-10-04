# pqa-qa verdict: production increment 2, r1 (security and product)

**Candidate:** the `git diff --cached` set in `.worktrees/production-readiness` (30 files, base `a350118`), described in `inc2-candidate.md`. It covers:
- I7: `admin:grant`;
- I4: password reset and verification resend;
- I8: native Firebase persistence in the OS keystore.

**Rules held:**
- No cloud calls, no commits, no edits to the index.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.
- I did **not** rerun the native Maestro flow. The emulator is shared with another project's apps, and starting the API, the Auth emulator and the adb reverses there would touch shared state. I reviewed the recorded artifacts instead.

## What I ran
- **`pnpm verify` with Node v24.21.0:** EXIT=0.
  - `check:secrets` scanned 585 files with no findings.
  - Script tests: 42.
  - Test counts: contracts 17, domain 170, API 358 passed plus 2 skipped (including `admin-grant.test.ts`), mobile 721.
  
  These match the candidate.
- **`pnpm test:e2e:firebase`** (local Auth emulator, `demo-pocketqa`; no cloud): **4/4**, EXIT=0.
  - Email sign-up, verify, sign in, choose a role; the session survives a reload.
  - Local password sign-in is refused in firebase mode.
  - **An unverified user can resend verification from sign-in.**
  - **Password reset gives the same answer for known and unknown emails, and the link really resets the password.**
  
  The worktree was clean afterwards.
- **Native evidence I inspected** (emulator only):
  - `inc2-native/maestro.txt` shows every step completed, including `stopApp`, a relaunch without clearing state, Discover visible and sign-in not visible, with `MAESTRO_EXIT=0`. The after-relaunch screenshot is the tester Discover screen.
  - `inc2-native-red/` (the memory-only `getAuth` build) fails at "discover-screen visible" after relaunch, `MAESTRO_EXIT=1`. Its failure screenshot is the sign-in screen.
  - So the flow does tell persistence apart from its absence.
  - The two identical "signed-in" and "after relaunch" PNGs are consistent: the same screen within the same minute (11:59).

## Verified as correct
- **`admin:grant`** is a host CLI only; I found no HTTP route.
  - It refuses local auth and a missing DB.
  - It requires a firebase identity with `has_recovery = 1`. That is set only at a verified email or Google account creation (`account.ts:122`) or a verified recoverable sign-in (`app.ts:117`). Wallet-login accounts start at 0.
  - It refuses accounts that are unknown, deleted, suspended or already admin, or that have a wallet link or any study or participation.
  - It requires a reason of at least 10 characters.
  - It is one transaction, with an audit row from actor `host-cli` that includes the reason and the OS operator.
  - The tests show nothing changes on refusal, and the role takes effect immediately and appears in `/admin/audit`.
- **Reset is enumeration-safe on the client.**
  - `auth/user-not-found` and every other unmapped `auth/*` code resolve like success.
  - Only invalid or missing email, rate limiting and network errors surface, and those are the same for known and unknown accounts.
  - Non-Firebase errors are shown as failures, never as success.
  - The emulator E2E confirms identical text. Firebase's server-side protection is access action A1+.
- **The unverified flow never treats the user as signed in to Pocket QA.**
  - `EMAIL_UNVERIFIED` leaves `user` null and `needsAccount` false. The app shows only the error and the resend button.
  - Resend always signs out, in a `finally`.
- **Keystore persistence:**
  - Native uses `initializeAuth` with `getReactNativePersistence(secureKv)` and fails loudly if the build lacks it.
  - `secureKey` escapes every character outside `[A-Za-z0-9.-]`, including `_` itself, so the mapping is injective and reversible (tested).
  - Refresh tokens live in the keystore, not AsyncStorage.
  - Web stays tab-scoped.

## Findings (all P3, non-blocking)

### P3-1: an abandoned unverified Firebase session stays on the device with no way to resend or clear it
- **Where:** `SessionProvider.tsx`.
  - The startup restore (`onIdToken` first callback) clears only on `UNAUTHENTICATED`.
  - `signIn` leaves Firebase signed in after `EMAIL_UNVERIFIED`, and nothing signs out when the user leaves the screen.
- **Scenario:**
  1. A user signs in unverified and closes the app.
  2. With I8, the unverified user's refresh token now persists in the keystore across restarts.
  3. On relaunch, `resolveManaged` gets 403 `EMAIL_UNVERIFIED`. The app shows signed-out sign-in **without** the resend button, because `unverifiedEmail` is false, and `token.current` still holds the unverified ID token.
- **Impact:** no privilege. The API refuses that token everywhere, and the user can sign in again. But it's a lingering credential, and the candidate's claim ("only until resend or leaving") isn't quite right.
- **Fix:** on a startup `EMAIL_UNVERIFIED`, either set `unverifiedEmail` (so resend shows) or call `clear()`. Also sign out of Firebase when the user leaves sign-in without resending. Add a unit test.

### P3-2: keystore value size
- Firebase's persisted `authUser` JSON (ID token, refresh token, provider data) is typically over 2 KB.
- The `expo-secure-store` docs warn that values over 2048 bytes "may fail" (iOS Keychain); Android works, as the emulator proof shows.
- **Fix:** record the measured value size in the ledger, and keep iOS managed sign-in as an explicit open gate. Chunking is the fix if iOS becomes a target.

### P3-3: admin account hardening is procedural
- `admin:grant` trusts the identity row's email, set at verified account creation. There is no recent-sign-in check, and admins have no second factor (MFA needs Identity Platform, which needs billing, which isn't approved).
- **Fix:** document in the ledger or runbook that the operator confirms the person out of band before granting. Recommend admins use Google sign-in with 2-step verification, and record "admin MFA" as a residual risk.
- Optionally, accept `--uid` and require it to match the identity subject, so a stale or reused email can't be promoted by mistake.

### P3-4: the native proof is a development prebuild on an emulator
- The persistence proof used `expo prebuild` in the development environment (cleartext loopback) on an AVD.
- **Fix:** keep "production prebuild on a physical Android device" open in the ledger. The candidate already says emulator only.

## Gates still not run (kept open)
- **A real reset email (I5) and live sign-up (I3):** blocked on access actions A1 and A2.
- **iOS managed sign-in.**
- **Native persistence on a physical device and in a production prebuild.**
- **Backup and restore** (B3).
- **Wallet hardware.**

VERDICT: APPROVE
