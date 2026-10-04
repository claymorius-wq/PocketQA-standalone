# pqa-qa verdict r1: auth screens and the PR #2 merge (PR #3, HEAD 75e009a)

I compared main (9461db5, `git show origin/main:<file>`) with HEAD for these files: `apps/mobile/app/(auth)/_layout.tsx`, `sign-in.tsx`, `sign-up.tsx`, `apps/mobile/app/index.tsx`, `apps/mobile/src/screens/authParts.tsx` and `apps/mobile/src/glass/Ground.tsx` (GroundFade). I also compared the kit pieces those files use (Screen, Field, Segmented, Notice, Text, Button, Enter). I read both new test files, every e2e, e2e-firebase and Maestro flow that touches these screens, and the merge, using `git show 3f02178 --cc`, `git diff 0e5b1d0 HEAD`, `git merge-base` and `git cat-file`. To answer the Notice question I read the installed react-native-web 0.21.3 and react-native 0.86.3 renderer sources. I ran nothing: no build, no test, no server.

Every behaviour of main's Sign in and Sign up is still on HEAD, with the same session calls, copy and testIDs. The Lens changes only affect drawing and timing. HEAD also fixes a real bug on main in the "Check your email" notice. This area is safe to merge. All three findings are P3.

## Checked
- **Local sign-in.** HEAD makes the same `signIn(email.trim(), password)` call, with `disabled={!email || !password}`, `loading={busy}`, and the shared `run()` that shows the server's message or falls back to "Sign-in failed." (`apps/mobile/app/(auth)/sign-in.tsx:87-113,181`; main `sign-in.tsx:62-74,102`). U1 only adds timing: it is armed on the press, disarmed on a failure, and `accepted` blocks a second sign-in while the pass plays.
- **Sign up.**
  - Same `signUp({ email.trim(), password, displayName.trim(), role })` call, same 12-character rule and disabled rule, same busy state.
  - "Couldn’t create account" still falls back to "Sign-up failed.", and the role switch keeps `role-tester|builder` (`apps/mobile/app/(auth)/sign-up.tsx:30-45,51-76`; main `sign-up.tsx:19-59`).
  - Both role notes are rendered; the hidden one is aria-hidden and `no-hide-descendants` (`apps/mobile/src/screens/authParts.tsx:177-218`).
- **Demo preview.**
  - The demo accounts load once and only fill the fields, never submit; picking a role clears the error.
  - `demo-accounts` and `demo-role-*` are kept.
  - In the preview build there is still no `go-sign-up` link, and the preview footer shows (`sign-in.tsx:65-85,160-174,236-250`).
- **PR #2 on Sign in**, all with main's copy and testIDs:
  - The `signInFooter(...)` small print (`sign-in.tsx:173`).
  - Google: only in firebase mode on web, disabled while busy (`:36,260`).
  - Wallet: only with walletLogin, on web, with a Wallet Standard wallet. NOT_FOUND shows "Create an account with this wallet", then a second, fresh `signInWithWallet({ role, displayName })` (`:35,225,263-279`).
  - "Finish your account": shown for needsAccount, prefilled from pendingProfile, with the role choice and `completeAccount` (`:42-46,200-232`).
  - The API's "Verify your email" still lands in `sign-in-error` through `run()`.
- **PR #2 on Sign up.** `verificationSent` and `sign-up-verify` are kept (`sign-up.tsx:27,38,67-72`).
- **U1 with PR #2.**
  - When a managed sign-in lands in needsAccount, Sign in works again and U1 is disarmed (`sign-in.tsx:118-129`).
  - Google, wallet and Create account go through `runPlain`, so they never use U1 (`:132-136`).
  - Tested in `apps/mobile/__tests__/auth-screens.test.tsx:427-498`.
  - `accepted` is set only after `signIn` resolves. After that either `user` is set, which redirects, or needsAccount resets it.
- **Redirects.**
  - `apps/mobile/app/index.tsx:16-19` routes by role as on main; only `brand` was added to the loader. The root guard (`apps/mobile/app/_layout.tsx:48`) is unchanged.
  - `apps/mobile/app/(auth)/_layout.tsx:21-43` still sends any signed-in user to `/`. It holds only an armed Sign in, and only until the pass peaks (at most press + 280 + 680 ms), when glass and motion allow it. The release timer also disarms.
  - Sign up, a restored session, Google, wallet, reduced motion and the light theme leave at once (`apps/mobile/__tests__/auth-layout.test.tsx:87-130`).
- **"Check your email" is a real bug on main.**
  - The kit wraps Notice children in `<Text variant="bodySm" tone="muted">` only when they are a single string (main `apps/mobile/src/ui/status.tsx:81`). Main's sign-up passes three pieces (main `apps/mobile/app/(auth)/sign-up.tsx:56`), so they sit bare inside a View.
  - **On web**, the body renders as raw DOM text in the browser's default font and colour (black, so low contrast on the dark notice) instead of the muted body text. Dev builds also log "Unexpected text node … cannot be a child of a <View>" (`node_modules/react-native-web/dist/exports/View/index.js:54-58`).
  - **On native** (RN 0.86.3, Fabric only), it does not throw:
    - Dev builds log "Text strings must be rendered within a <Text> component." (`node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-dev.js:15889-15898`).
    - Prod builds create an RCTRawText node without any check (`ReactFabric-prod.js:10341`).
    - That node is never laid out or drawn (`node_modules/react-native/ReactCommon/react/renderer/components/text/RawTextShadowNode.h:23`, `.../components/view/YogaLayoutableShadowNode.cpp:227-258`).
    - So only the title shows, and the instructions and email address are missing.
  - **HEAD fixes it** by passing one template string (`apps/mobile/app/(auth)/sign-up.tsx:69-71`), which the kit wraps at `apps/mobile/src/ui/status.tsx:141`. `auth-screens.test.tsx:566-578` pins this.
- **Error mapping and session code are untouched.** `git diff origin/main HEAD` changes nothing in `apps/mobile/src/auth`, `src/api`, `src/preview`, `src/wallet` (apart from WalletSection's drawing), `packages` or `apps/api`. Both screens still show `e.message` as on main.
- **testIDs and text used by the e2e flows all still exist with the same meaning.** This covers `apps/mobile/e2e/*.spec.ts`, `e2e-firebase/firebase-auth.spec.ts`, `e2e/preview/browser-smoke.mjs` and `e2e/maestro/*.yaml`:
  - Sign in: `sign-in-screen`, `sign-in-email`, `sign-in-password`, `sign-in-submit`, `sign-in-error`, `sign-in-wallet`, `finish-account`, `finish-name`, `finish-submit`, `demo-accounts`, `demo-role-*`, `go-sign-up`.
  - Sign up: `sign-up-name`, `sign-up-email`, `sign-up-password`, `sign-up-submit`, `sign-up-verify`, `role-*`, `go-sign-in`.
  - Text: "Check your email", "Finish your account", "Create an account with this wallet", and the footer strings. The new clause-dot Text keeps the footer's characters identical (`apps/mobile/src/ui/text.tsx:60-95`).
- **Security.**
  - No logging and no token handling in `apps/mobile/app`, `src/screens`, `src/ui` or `src/glass` (grep).
  - The custom token is still exchanged only in `apps/mobile/src/auth/SessionProvider.tsx:133-141` and is never used as a bearer.
  - The demo password stays in a secure Field.
  - The Commit pass plays only after `signIn` resolves, and "Check your email" shows only when the session reports `verificationSent`.
- **Merge `3f02178`.**
  - Every line from main's side is still present on HEAD, moved into the Lens layout.
  - The Lens side's U1 is kept; its `submit` was restructured into `run()` plus the `answered` effect.
  - review-loop keeps main's `LIGHT_GROUND`/`DARK_GROUND`, `effectiveBackground` and `expect.poll`. The Lens helper it dropped had no other users.
  - The merge tree is the same as ccdc47c's (5528d69). `75e009a` only changes ADR numbers under `apps/`.

## Findings
1. [P3] U1 never dims Sign in's key light. `apps/mobile/app/(auth)/sign-in.tsx:140`.
   - `useUplight` is called in `SignIn`, which renders above the Ground that `Screen` creates (`apps/mobile/src/ui/index.tsx:204`). So `useKeyLight()` returns null (`apps/mobile/src/glass/keyLight.ts:19-22`), and the moment is never registered (`apps/mobile/src/glass/Uplight.tsx:69,78`).
   - ADR 0006 (line 99) says every Uplight moment registers with its screen's Ground. The session screen does this correctly, from children inside its Screen (`apps/mobile/app/participation/[id].tsx:153`).
   - Visual only.
   - Fix: create the light in a component rendered inside the Screen, share it with the dock and the card, and add a test in `auth-screens.test.tsx` that the pool dims.
2. [P3, unverified] On a phone browser, the keyboard may cover Sign in. `apps/mobile/app/(auth)/sign-in.tsx:152-155,181`.
   - Sign in moved from just under the password field (main `sign-in.tsx:102`) into the bottom-edge dock, which only moves above the keyboard on native.
   - On web, `useKeyboardShown` is always false (`apps/mobile/src/ui/index.tsx:715`) and the dock's KeyboardAvoidingView has no behaviour set (`:313`). Mobile browsers draw the keyboard over the bottom of the page.
   - Neither branch submits from the password field's return key.
   - I have not tried this on a device.
   - Fix: check the web preview on Android Chrome and iOS Safari. If Sign in is covered, submit from the password field's return key, or raise the dock using `visualViewport` on web.
3. [P3] The Firebase e2e test cannot catch a broken verify-notice body. `apps/mobile/e2e-firebase/firebase-auth.spec.ts:26` only checks the title, so it also passed with main's broken body.
   - Fix: also expect `sign-up-verify` to contain "We sent a verification link to".

## Verdict
APPROVE
