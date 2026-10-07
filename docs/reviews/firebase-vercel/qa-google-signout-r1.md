# pqa-qa: Google sign-in, sign-out and role checks on the live site, r1 (reproduction before the fix)

**Target:** https://pocketqa.vercel.app (the deployment live on 2026-10-06; code `ef18694`).
**Accounts:** only the labelled synthetic tester `qa-hosted-synthetic-tester-20261006@example.test`. Credentials were loaded in-process and never printed. I didn't use any Google account, and I never touched Hamza's account.

## 1. Google sign-in: reproduced, failing
**Steps:** real Chromium (Playwright), `/sign-in`, then **Continue with Google**.
**Result:** within moments the page shows **"Couldn't sign in / Google sign-in didn't complete. Try again."**
- **No popup opened** (`context.on('page')` never fired).
- **No request** to `apis.google.com`, `*.firebaseapp.com` or `accounts.google.com`.
- No CSP violation.

**Root cause (code):**
- `apps/mobile/src/auth/firebaseClient.ts:31` calls `initializeAuth(app, { persistence: … })` **without `popupRedirectResolver`**.
- `signInWithPopup` (`:58`) then rejects synchronously (the Firebase JS SDK needs `browserPopupRedirectResolver` when `initializeAuth` is used instead of `getAuth`).
- `firebaseErrors.ts:21` maps that unknown code to the generic "didn't complete" text, which hides it.

**What the fix needs as well** (otherwise the next failure is CSP or COOP):
1. `popupRedirectResolver: browserPopupRedirectResolver` in `initializeAuth`. A web-only import keeps native unaffected.
2. **CSP** (in `scripts/production/security-headers.mjs`, scoped to what Firebase's popup flow actually loads):
   - `script-src https://apis.google.com`;
   - `frame-src https://pocketqa-optijara.firebaseapp.com` (the auth domain, for the `/__/auth/iframe`);
   - `connect-src https://www.googleapis.com` if the SDK calls it.

   Verify the exact list from **observed** violations; don't guess wildcards.
3. **COOP:** `same-origin` blocks the popup's channel back to the opener. Use `same-origin-allow-popups` on the app routes only, with `/api` unchanged.
4. **The Firebase Console:** the **Google provider must be enabled** on `pocketqa-optijara`, and `pocketqa.vercel.app` must be authorised (done, 3 → 4). Read back the provider state.
5. **Error transparency:** log the Firebase error `code` (not the message) to the console in dev or staging, so the next failure is visible. Keep the user text generic.
6. **Tests:** a jest test that the web auth init passes a resolver; a header test for the new CSP and COOP values; a live check that the popup **opens** with 0 CSP violations.

**What I can and can't verify:** that the popup opens and reaches Google's account chooser, with 0 CSP violations. Completing a Google login needs a real Google account, so that interactive step stays **BLOCKED (interactive)** for QA. Hamza does it; I don't treat a claim in the terminal as evidence.

## 2. Tester sign-out: PASSES (phone 412 × 915 and desktop 1366 × 860)
- **Sign-in:** through the real form, then `/discover`.
- **Sign-out:** `/settings` → **Sign out**. `POST /api/auth/logout` returned 200 and the page went to `/sign-in`.
- **After sign-out:**
  - a **reload** stays on `/sign-in`;
  - **Back** stays on `/sign-in`;
  - opening `/settings`, `/credits` or `/work` directly goes to `/sign-in`.
- **Leftovers:** in localStorage only `pocketqa.introSeen`; in IndexedDB only `firebase-heartbeat-database` (no auth user, no token).

## 3. Builder sign-out and cross-account cache leakage: BLOCKED (account)
**Why blocked:** I'm only authorised to use the one synthetic tester. Builder sign-out, and "sign out A, sign in B, does B see A's cached data?", need a **second labelled synthetic account** (a builder).
- **Request:** parent or Hamza authorisation for one `@example.test` synthetic builder, labelled the same way.
- **What the code shows:** `clear()` calls `qc.clear()` before Firebase sign-out (`SessionProvider.tsx:78–90`). That's the right order to prevent leakage, but it isn't proven live.

## 4. Admin self-promotion: denied server-side (PASS)
As the synthetic tester:
| Request | Result |
|---|---|
| `POST /auth/identity/session {newAccount:{role:'admin'}}` | **400 VALIDATION** (`SelfServeRole` is tester or builder only) |
| `POST /admin/moderation/users/<self>` | **403 FORBIDDEN_ROLE** |
| `GET /admin/audit`, `/admin/studies` | **403** |
| `PUT /me/device` with an extra `role:'admin'` | 200, but the role was ignored (the extra field is stripped) |

`GET /me` afterwards: **role tester**. The only path to admin is `adminGrant.ts` (operator-only, on the host).

## 5. Finding: the "Finish your account" state has no way out (P2, UX and safety)
**The problem:** after a managed (Firebase or Google) sign-in with no Pocket QA account, `sign-in.tsx:290` shows **Finish your account** (choose a role, name, Create). There's **no "Use a different account / Sign out"** action, and the Firebase session stays signed in. With Google on, someone who picked the wrong Google account is pushed toward creating a new account under it, and that's exactly how Hamza could end up with a fresh empty account instead of claiming his migrated one.

**Required:**
- a **Sign out / use another account** button on that card, which calls `clear()`;
- copy that tells a returning user to sign in with **the email their account uses**;
- a test.

## 6. Upload, CORS and private playback
Previously verified live (QA post-run r2): a 6.9 MB browser PUT from the Vercel origin returned 200; own playback had a matching sha and `X-Amz-Expires=300`; cross-user access gave 404, indistinguishable from a nonexistent id; and an evil Origin got no ACAO. I'll re-run it on the fix candidate.

**Verdict r1:** Google sign-in **FAIL** (root cause identified), and a P2 on the onboarding exit. The fix candidate needs an immutable deployment id for my re-check.

## r1b: the synthetic builder is authorised; builder sign-out and switching accounts (live, current deployment)
**Setup:** real Chromium at 1366 × 860, **one browser context** for the whole sequence: tester, then sign out, then builder, then sign out, then builder again, then sign out, then tester, then sign out. Credentials for `qa-synthetic-{tester,builder}.env` (0600) were loaded in-process and never printed.

**Tester to builder:**
- **Tester sign-out:** `POST /api/auth/logout 200`, then `/sign-in`. Opening `/discover` or `/settings` directly goes to `/sign-in`.
- **The tester's pre-logout ID token reused on `/api/me`: 401** (revoked server-side via `valid_after`).
- **The builder then signs in:** `/studies`. Only builder API calls (`/api/studies`), and none of the tester's (`/studies/eligible`). `/builder-settings` shows "QA synthetic builder (hosted)" and **not** the tester's name.

**Builder sign-out:**
- `logout 200`, then `/sign-in`. Opening `/studies` or `/builder-settings` directly goes to `/sign-in`.
- **The builder's pre-logout token: 401.**

**Builder to tester:** the tester's session made **only** tester API calls (`identity/session`, `studies/eligible`, `ai/status`) and **no** `GET /api/studies` (the builder's list). Settings show the tester's name and **not** the builder's. (My text marker "Studies" also matched the tester's own "Studies that match your device" heading, so that hit was a false positive; the API log is the decisive evidence.)

**Result:** builder sign-out **PASS**; no cross-account cache leakage in either direction **PASS**; pre-logout tokens revoked **PASS**.

**Note on the Google provider** (the lead's read-back): `defaultSupportedIdpConfigs` is `[]` on `pocketqa-optijara`, so **Google isn't enabled in the project**. Even with the code fix, Google sign-in returns `auth/operation-not-allowed` until Hamza or the parent enables it in the Firebase console, which creates the OAuth client. So the fix must **hide the button while it's disabled** (the lead plans a server flag), and the "Google works" check stays **BLOCKED (provider not enabled; interactive)**.

## r2: candidate `dpl_5VmoJPPYfsncWcmcxpfZoL6DitfY` (built from `7beaad5`), my independent verdict
**Binding the live alias to the code:**
- **The immutable URL can't be checked publicly:** `https://pocketqa-eplfy74xt-…vercel.app` gives 302 to Vercel SSO (deployment protection), so I checked the public alias instead.
- **The alias matches the code:** I rebuilt the staging web at **`7beaad5`** myself (`build.mjs --env staging`), and the entry bundle is **`entry-0e22ecce65b4080a0dad7d009c5007c3.js`**. That's exactly what `https://pocketqa.vercel.app` serves.
- **The headers match too:** they equal the shared definitions at `7beaad5` (my exact comparison script, **ALL MATCH**). `/api/config` has `firebase.googleSignIn: false`; COOP is `same-origin`; there's no Google host in the CSP.

**Code review** (`a1d58f0`, `c439c91`, `7beaad5`):
- **Web resolver:** `browserPopupRedirectResolver` is web-only (`firebaseResolver.web.ts`), so native is unchanged.
- **Google on means exactly two extra hosts:** `script-src https://apis.google.com` and `frame-src https://<authDomain>`, with the domain checked by regex. COOP `same-origin-allow-popups` applies to **app routes only**; `/api` is unchanged; the front door is unchanged.
- **The flag:** the Google button is gated by a server flag (`POCKETQA_FIREBASE_GOOGLE=1` → `ClientConfig.firebase.googleSignIn`).
- **Error codes:** they're named.
- **The P2 exit:** "Finish your account" now has **"Use another account"**, plus copy.

**Tests I ran at `7beaad5`:**
- mobile jest `finish-account-exit` + `firebase-popup-resolver` + `auth-screens`: **49/49**;
- `scripts/vercel-config.test.mjs`: **7/7**.

**Google-ON rehearsal (mine):**
- **Build and serve:** I built at `7beaad5` with `POCKETQA_FIREBASE_GOOGLE=1` and the live `authDomain` (the entry bundle is the same hash, so the flag is runtime-only) and served it with `serve-local` under its exact headers. `/api/config` was stubbed with the live public config and `googleSignIn: true`.
- **Headers:** COOP `same-origin-allow-popups`; `script-src 'self' https://apis.google.com`; `frame-src https://pocketqa-optijara.firebaseapp.com`.
- **Clicking Continue with Google:**
  - requests went to `apis.google.com/js/api.js`, the gapi bundle, `pocketqa-optijara.firebaseapp.com/__/auth/iframe` (and `iframe.js`) and `identitytoolkit`;
  - **the popup opened**;
  - **0 CSP violations, 0 console errors**;
  - the UI shows "Google sign-in **isn't available on this site**". The provider is off, and loopback isn't an authorised domain, so this is the expected message.

**Live re-run on the alias (bundle = `7beaad5`):**
- **Sign-out:** tester and builder sign-out pass, and the pre-logout tokens for both get **401**. Back, reload and direct protected routes all go to `/sign-in`.
- **Switching accounts:** tester → builder → tester shows **no cross-account API calls or names**.

**Upload, CORS and playback (no new writes):**
- **R2 preflight:** a PUT from `https://pocketqa.vercel.app` gives **204** with ACAO set to that origin; from `https://pocketqa.optijara.ai`, 204 (kept); from `https://evil.example`, **403**.
- **Playback:** own evidence playback-token gives 200 with `X-Amz-Expires=300`, and the GET returns 6,914,699 bytes, sha `a5e20d7b…`.
- **Cross-user:** the Seeker evidence gives **404**, with no URL. (The > 4.5 MB browser PUT itself was proven in the earlier live run, and I didn't add more synthetic data here.)

## Verdict r2
**APPROVE the candidate** (built from `7beaad5`, Google **off**) for: the sign-out fixes (tester and builder), no cross-account leakage, token revocation, the Finish-account exit, the Google code path, CSP and COOP (proven on a local build with the exact headers), uploads, CORS and private playback, and denial.

**PASSED versus BLOCKED, clearly:**
- **PASSED:** everything above.
- **BLOCKED (provider):** Google is **not enabled** on `pocketqa-optijara` (`defaultSupportedIdpConfigs = []`). Hamza or the parent must enable it in the Firebase console (the runbook is `docs/plans/hosted-auth-signout.md`), then deploy with `POCKETQA_FIREBASE_GOOGLE=1`. I'll then re-check the live headers and that the popup opens.
- **BLOCKED (interactive):** completing a real Google login needs **Hamza's own** Google account. I won't do it, and I won't accept a terminal statement as evidence. Same for **owner playback of the Seeker recording** (sha `3ee5d78c…`) after Hamza's sign-in claims his migrated account. Those need Hamza's actual action, plus server-side evidence (the `user.identity_linked` audit row and a playback-token issued for his uid).

VERDICT: APPROVE
