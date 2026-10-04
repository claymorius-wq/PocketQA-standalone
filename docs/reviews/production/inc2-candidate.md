# Candidate: production increment 2 (admin provisioning, account recovery, native session)

**Base:** `a350118` (increment 1). The changes are uncommitted and frozen; the reviewable set is `git diff --cached`.

**Ledger rows:** I4, I7 and I8 (code and emulator). I5 (a real reset email) and I3 (live sign-up) stay blocked on A1 and A2.

## Changes

### I7: `admin:grant` (`apps/api/src/adminGrant.ts`, `apps/api/scripts/grant-admin.ts`, `pnpm --filter @pocket-qa/api admin:grant <email> --reason "..."`)
- It is a host CLI only, with no HTTP route.
- It refuses local-auth deployments (use `admin:create` there), and a missing DB.
- It promotes an existing account only if all of these hold:
  - the account has a verified managed identity (firebase identity with `has_recovery = 1`, i.e. email or Google; wallet-only accounts are refused);
  - it is active and not already an admin;
  - it has **no wallet link**;
  - it has **no studies or participations** (a dedicated admin account, so no orphaned work).
- It needs a reason of at least 10 characters.
- It runs in one transaction with an audit row: actor `host-cli`, action `user.admin_granted`, and the reason plus the host operator's OS username.
- The role applies on the next request, because roles are read server-side on every request.
- Tests: `test/admin-grant.test.ts` covers the first admin on a fresh firebase-mode DB, that it shows in `/admin/audit`, every refusal with nothing changed, and the CLI's refusals.

### I4: password reset and verification resend (firebase mode)
- **`firebaseClient.ts`:** `passwordReset` (`sendPasswordResetEmail`) and `resendVerification` (`sendEmailVerification` on the current user).
- **`SessionProvider`:**
  - When the API refuses a sign-in with `EMAIL_UNVERIFIED`, the app stays signed in to Firebase **only** so it can resend. `resendVerification` sends, then always signs out.
  - `sendPasswordReset` resolves identically whether or not the account exists. Only an invalid email, rate limiting or network errors surface. Non-Firebase errors are shown as failures, never as success.
- **Sign-in screen:**
  - "Forgot password?" sends a reset link to the email in the field. The notice reads "If an account uses this email, a reset link is on its way."
  - "Resend verification email" appears after an unverified refusal.
  - The hero copy no longer mentions test credits when they're off.
- **Tests:**
  - `e2e-firebase/firebase-auth.spec.ts` gains two tests against the Auth emulator:
    - resend creates a second `VERIFY_EMAIL` code;
    - reset shows the same text for known and unknown emails, and the emulator's reset code really changes the password, after which sign-in with the new one works.
  - `__tests__/firebase-errors.test.ts` covers the reset mapping.

### I8: native session persistence
- `firebaseClient.ts` now always uses `initializeAuth` with `firebasePersistence()`:
  - **Web (`firebasePersistence.ts`):** `browserSessionPersistence`, unchanged and tab-scoped.
  - **Native (`firebasePersistence.native.ts`):** `getReactNativePersistence(secureKv)`.
- `secureKv` (`src/auth/secureKv.ts`) stores Firebase's state in the **OS keystore** (`expo-secure-store`), not AsyncStorage. Keys are escaped reversibly (`_xHH`) into the keystore alphabet.
- The RN build of `@firebase/auth` is resolved by Metro. Its TS types are web-only, so the native file uses a narrow cast plus a runtime check that throws if the build lacks it.
- **Tests:** `__tests__/firebase-persistence.test.ts` covers key escaping round-trip and no collisions, that persistence uses the keystore adapter, and that it fails loudly if missing.

## Evidence
- **API:** `test/admin-grant.test.ts`, 3/3.
- **`pnpm test:e2e:firebase`** (Auth emulator `demo-pocketqa`, browser plus API in firebase mode): **4/4**, EXIT=0 (`inc2-e2e-firebase.txt`).
- **Native, EMULATOR ONLY** (AVD `Medium_Phone_API_36.1`, `sdk_gphone64_arm64`, Android 16). No physical device was used.
  - **Setup:**
    - `expo prebuild --platform android` (development env; cleartext loopback only).
    - `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` produced `app-release.apk` with sha256 `b19367895794a00a2ea725f94c6e7689df4105cee399eacbc4107b81057ce81d`. Rebuilding gave the same hash.
    - The Auth emulator plus the API in firebase mode, via `adb reverse` 8787 and 9099.
  - **Green:** `maestro test e2e/maestro/firebase-persistence.yaml` signs in, finishes the account, lands on Discover, **force-stops** the app and relaunches. Discover is shown and Sign-in is not. `MAESTRO_EXIT=0` (`inc2-native/`).
  - **Red check:** the same flow against a build where native used `getAuth(app)` (the old memory-only code, sha256 `a233bde4…`). It **fails at "discover-screen visible" after relaunch**, `MAESTRO_EXIT=1` (`inc2-native-red/`). So the flow detects the regression.
  - Two earlier red attempts failed for unrelated reasons, and neither counts as evidence:
    - the first reused an existing account;
    - the second had the Mock MWA Wallet in the foreground on the shared emulator.
  
  The flow now scrolls to `finish-submit`. The temporary red edit was reverted, which the restored hash confirms.
- **`pnpm verify`:** EXIT=0.
  - Secrets scan: 585 files.
  - Test counts: scripts 42, contracts 17, domain 170, API 358 plus 2 skipped, mobile 721.
  - Output: `inc2-pnpm-verify.txt`.
  - The new `KeyRound` and `Mail` icons are mapped to existing Lens glyphs (`lock`, `send`).
- **Playwright (`apps/mobile`, local mode):** 11/11, `PW_EXIT=0` (`inc2-playwright.txt`). The screenshots it rewrites were restored.
- **Firebase emulator E2E,** re-run on the final tree: 4/4.

## Review asks
- **`admin:grant` preconditions:** is anything missing? For example, should it also require a recent sign-in, or refuse when the email is unverified in Firebase itself, rather than relying on the identity row?
- **The unverified flow:** keeping the Firebase user signed in until resend or leaving. Is there any path where the app treats that user as signed in to Pocket QA?
- **Reset:** confirm the enumeration-safety reasoning. Firebase's server-side protection is A1+.
- **Keystore persistence:** value sizes, iOS keychain reinstall behaviour (out of scope: iOS is not a production target for managed sign-in yet), and key escaping.

## r1 follow-ups (`inc2-verdict-qa-r1` APPROVE, all P3)
- **P3-1.** `endsRestoredSession` (`managedSession.ts`) clears a restored Firebase session that the API refuses as `UNAUTHENTICATED` **or `EMAIL_UNVERIFIED`**. Leaving the sign-in screen after an unverified refusal calls `discardUnverified()`, which signs that Firebase user out. Refs are used, so only unmount triggers it. Covered by a unit test.
- **P3-2, P3-3 and P3-4** are recorded in the acceptance ledger's "Residual risks and open notes":
  - keystore value size, and iOS managed sign-in as an open gate;
  - admin MFA as a residual risk, with out-of-band confirmation required;
  - the native proof was a development prebuild on an emulator; a production prebuild on a physical device stays open.
