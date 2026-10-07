# pqa-qa: Google sign-in and sign-up button, visual QA r1. Baseline on the live site, before the lead's polish candidate

**Live state now:** `/api/config` has `firebase.googleSignIn: true`. App CSP is `script-src 'self' https://apis.google.com` and `frame-src https://pocketqa-optijara.firebaseapp.com`. COOP is `same-origin-allow-popups`. (The provider is enabled per Hamza and the parent; I don't assume the old blocker still applies.)

**Screenshots:** real Chromium at 2× DPR, phone 390 × 844 and desktop 1366 × 860, light and dark, `/sign-in` and `/sign-up`. Kept locally (ignored) in `.qa-shots/live-*.png`.

## Baseline observations (what the polish must fix)
| # | Observation | Reference |
|---|---|---|
| B1 | **No Google "G" logo.** The button is text only: "Continue with Google" | Google's branding guidelines (developers.google.com/identity/branding-guidelines): the standard full-colour "G", unmodified in size and colour, **on a white background in every theme** |
| B2 | **Dark theme:** the button is drawn as a Pocket QA purple tile (looks like a primary action) | Allowed themes: Light `#FFFFFF` fill, `#747775` 1 px stroke, `#1F1F1F` text; Dark `#131314` fill, `#8E918F` stroke, `#E3E3E3` text; Neutral `#F2F2F2` with no stroke, `#1F1F1F` text |
| B3 | **The width doesn't match the primary button:** the Google button is 318 × 52 at x = 37 (phone) and 680 × 52 at x = 344 (desktop); the Sign in button is 358 × 52 at x = 16 and 720 × 52 at x = 323. It sits inside the card and the primary sits outside it, so their edges don't line up | Responsive full width, consistent spacing |
| B4 | **Order and grouping:** the **Sign in** primary is at the very bottom, below the footer text and outside the card, while the Google button sits in the card above it. There's no "or" divider between email/password and Google | Hierarchy |
| B5 | **No Google option on `/sign-up`** (0 Google buttons in all 4 combinations), although sign-up through Google is part of the request ("Sign up with Google" or "Continue with Google") | Request: both routes |
| B6 | 0 CSP violations and 0 console errors on both routes, both themes and both sizes | ✓ |

## What I'll require of the candidate (approve or deny)
1. **Logo:** the **official** multicolour "G" (an exact SVG asset, not redrawn, not tinted), always on a white logo surface, also in dark theme.
2. **One reusable component** (`GoogleButton` or similar) used on **both** `/sign-in` and `/sign-up`, with the approved text: "Continue with Google" or "Sign in with Google" / "Sign up with Google".
3. **Theme:** a Google-approved light or dark theme (or neutral), with exact colours. Radius, height and full width aligned with Pocket QA's primary button. Spacing tokens, with an "or" divider.
4. **States:**
   - **loading:** a spinner, a busy label, the button disabled, `aria-busy`;
   - **disabled:** while another sign-in runs, and when `googleSignIn` is false the button is **hidden** (not just disabled);
   - **focus:** a visible ring of at least 3:1 against both themes;
   - **pressed and hover.**
5. **Accessibility:**
   - `role=button`, with an accessible name equal to the visible text and the logo `aria-hidden`;
   - contrast AA (text 4.5:1);
   - a target of at least 44 × 44;
   - keyboard: Tab focuses it, Enter and Space activate it.
6. **Clicking:**
   - one click opens exactly **one** popup, and a double-click while busy doesn't open a second;
   - cancel ("popup closed") returns to idle with the cancelled copy;
   - the error code is named.
7. **No regression:**
   - the email sign-in, sign-up, "Finish your account" exit, sign-out and role routing all still work (tests plus my live re-run);
   - 0 CSP violations on both routes;
   - the native app isn't affected (web-only resolver; native button hidden or handled).
8. **Evidence:** the candidate's own screenshots (phone and desktop × light and dark × both routes), the jest tests for the component (states, a11y, click), and an immutable deployment id or SHA. I re-shoot it myself.

**Out of scope for my approval, as before:** completing a real Google login (a human with a real Google account). Popup-open proof is separate from that.

## r2: candidate `a8ea776` (not deployed), re-shot independently on my own build
**Assets:** I downloaded `signin-assets.zip` from Google myself. The official `Light/…Show text=No, Shape=Square…svg` hashes to `6587b180…` and `Dark/…` to `2f7ecc30…`, the same as the pinned hashes. And `googleG.ts` embeds **both files verbatim** (I checked the file text). ✓

**My screenshots:**
- **Build:** at `a8ea776`, with `POCKETQA_FIREBASE_GOOGLE=1` and the live `authDomain`, served by `serve-local` under its exact headers. `/api/config` was stubbed with the live public config.
- **Coverage:** Chromium (phone 390 and desktop 1366 × light and dark × `/sign-in` and `/sign-up`) plus WebKit (phone × light and dark × both routes). The files are `.qa-shots/cand-*`, including focus crops.

| Check | Result |
|---|---|
| **Present on both routes** | 1 button each: "Continue with Google" on `/sign-in`, "Sign up with Google" on `/sign-up` (B5 ✓) |
| **Alignment** | Phone `x 16, w 358, h 52`; desktop `x 323, w 720, h 52`. **Equal** to the primary button on every combination (B3 ✓). "or" divider on `/sign-in` (B4 ✓) |
| **Theme, measured** | Light: bg `rgb(255,255,255)`, border `rgb(116,119,117)` 1 px, text `rgb(31,31,31)`. Dark: `rgb(19,19,20)` / `rgb(142,145,143)` / `rgb(227,227,227)`. Those are Google's exact light and dark values (B1, B2 ✓). Contrast is 16.48 (light) and 14.47 (dark) |
| **Accessibility** | The accessible name equals the visible label; the G's wrapper is `aria-hidden` (✓) |
| **Focus** | A visible 2 px solid ring, `rgb(52,66,194)` in light and `rgb(111,155,255)` in dark, clear in the crops. 52 px tall |
| **Keyboard and clicks** | Enter, then 2 forced clicks: **exactly 1 popup**. While open, the button is disabled. After I close the popup, the button is enabled again, and the message is "isn't available on this site" (loopback isn't an authorised domain, as expected) |
| **CSP and console** | 0 violations and 0 errors in every combination, in both engines |
| **Tests** | jest `google-button` + `auth-screens` + `finish-account-exit`: **59/59** |

### P2-G1: the browser resolver loads Google's gapi script for everyone, and with Google off that's a CSP violation, so the hosted smoke fails
- **What I saw:** with a **Google-off** staging build (the default, and the state after any rollback), the hosted smoke (`playwright.hosted.config.ts`, on my emulator ports) **fails** with `script-src-elem` blocked on `https://apis.google.com/js/api.js?onload=__iframefcb…`, from `entry-…js` line 18728, during sign-up → verify → sign-in.
- **Cause:** `firebaseClient.ts:32` passes `popupRedirectResolver` to `initializeAuth` **always** on the web. Firebase then pre-initialises the gapi iframe when auth initialises, not when someone clicks Google.
- **Effect:**
  - every signed-in visitor loads a third-party Google script even if they never use Google (a privacy and performance cost);
  - with Google off, it causes CSP violations;
  - the existing gate test fails.
- **Fix:** don't pass the resolver at init. Pass it **at the call**: `signInWithPopup(auth, provider, browserPopupRedirectResolver)`. That's supported, and it loads gapi only on click.
- **Tests:** re-run the hosted smoke (Google off: 0 violations) and my Google-on rehearsal (one popup on click; no gapi request before the click).

### P2-G2: the loading state isn't wired
- **What I saw:** `GoogleButton` supports `loading` (a spinner and `aria-busy`), but both pages pass only `disabled={busy}` (`sign-in.tsx:417`, `sign-up.tsx:108`). Live, while the popup is open, `aria-busy="false"` with no spinner. The button only dims and disables, contrary to the candidate note.
- **Fix:** pass `loading` while **this** Google attempt is running. Keep `disabled` for other in-flight actions. Add a test.

### P3
1. **`/sign-up` has no "or" divider** between "Create account" and "Sign up with Google". It's inconsistent with `/sign-in`.
2. **Font:** the label uses Instrument Sans SemiBold. Google's guideline names **Google Sans Medium** for the button font. That's a brand-compliance trade-off for Hamza to accept or change; it's not blocking.
3. **Verify under load:** `pnpm verify` at `a8ea776` showed 7 mobile timeouts with the host load average at **28.85**, in suites this change doesn't touch (icons, settings, builder-study, review-screen, participation-session). Rerun alone, they pass **102/102**. The rest passed: check:secrets clean (1160), scripts 83, contracts 17, domain 222, API 680 + 2 skipped. That's the same known load-sensitivity as before, not this change.

**Verdict r2:** **CHANGES_REQUIRED** (P2-G1, P2-G2). The visual, theme, asset, alignment, a11y, focus and single-popup work is approved as is. Please send the fix SHA. I'll rerun the hosted smoke (Google off), my Google-on rehearsal (no gapi before the click, one popup, spinner and `aria-busy` while open), and the screenshots.

## r3: fixes at `a9d0e7e` (includes the `a0f201d` copy fix), re-run independently
| r2 | My evidence | Status |
|---|---|---|
| **P2-G1:** gapi at init | `firebaseClient.ts:34` calls `initializeAuth` **without** a resolver; `:61` calls `signInWithPopup(a, provider, popupRedirectResolver)`. **Hosted smoke, Google-off staging build, my emulator ports (`PQA_HOSTED_PORT=8597`): 2/2 passed** (headers, then 0 CSP violations through sign-up → verify → sign-in → tester home). **Google-on rehearsal** (Chromium and WebKit × `/sign-in` and `/sign-up` × light and dark): **0 requests** to Google or firebaseapp hosts **before the click** in all 8 runs. After the click: `apis.google.com`, `pocketqa-optijara.firebaseapp.com`, `www.googleapis.com` | **fixed** |
| **P2-G2:** loading not wired | All 8 runs: `aria-busy="true"` while the popup is open, with **a spinner in place of the G**; after closing the popup, `aria-busy="false"` | **fixed** |
| **Single popup** | A separate check that wraps `window.open`. A single click gives 1 call (3/3); a double click 250 ms apart gives **1 call and 1 page** (3/3). (My earlier "2 popups" count in some Chromium runs came from the handler page itself, not a second `window.open`) | ✓ |
| **P3:** "or" divider on `/sign-up` | Present (screenshot `r3-chromium-light-sign-up.png`) | **fixed** |
| **P3:** font | It stays Instrument Sans: Google Sans isn't licensed here. A brand trade-off for **Hamza** to decide | open (not blocking) |

**Gates at `a9d0e7e`:**
- jest (button, resolver, auth screens, finish exit): **65/65**;
- full mobile jest: **68 suites, 1390/1390** (host load about 4);
- check:secrets **1201 files, no findings**;
- 0 console errors and 0 CSP violations in every run.

**New P3 (cosmetic):** while the Google popup is open, the **Sign in** button also shows a spinner (a shared `busy`), so the screen shows two spinners. Consider limiting the primary's spinner to its own submit.

## Verdict r3
**APPROVE `a9d0e7e` for deploy** (Google button visuals, states, a11y, single popup, no gapi before the click, no auth regression in the hosted smoke and jest). After deploy, I'll re-check live on the alias, binding the bundle hash to my rebuild.

**Separate and still human-only:** a real Google account completing the sign-in, and Hamza claiming his migrated account. My evidence covers only the popup opening.

VERDICT: APPROVE

## r4: live re-check of `dpl_TRefQGTdR4A9VKMhUTAj3ib5meNe` (alias https://pocketqa.vercel.app)
- **The bundle is bound to the code:** my own rebuild of **`a9d0e7e`** (Google on, live R2 and auth domain) gives **`entry-d9b5472d9fac233b3df280ddb47bf7fa.js`**, the exact entry the alias serves.
- **Headers:** live `/sign-in`, `/sign-up`, a deep link, `/api/health` and `/api/config` headers **equal** the headers in my built `config.json` (**ALL MATCH**). That includes the Google CSP and COOP `same-origin-allow-popups` on the app routes, with `/api` unchanged.

**Live click** (no stubs; Chromium and WebKit × `/sign-in` and `/sign-up`, phone):
- **Before the click:** **0** requests to Google or firebaseapp hosts.
- **On the click:** `aria-busy="true"`.
- **Popups:** **one** `window.open` (to `pocketqa-optijara.firebaseapp.com/__/auth/handler`), even after a forced second click.
- **After closing the popup:** the button returns to idle after **9.1 s** (Chromium) or **8.9 s** (WebKit), with the "cancelled" message. That confirms the lead's P3.

**P3, cause found:** Chromium logs **2 console errors** after the click: *"Cross-Origin-Opener-Policy policy would block the window.closed call."* The Google sign-in pages the popup navigates to send their own COOP, which cuts off the opener, so the Firebase SDK can't poll `window.closed`. It only notices the cancel when its internal timeout fires, which explains the ~9 s busy after closing. This isn't our CSP; it's third-party and benign (success comes back over the auth iframe's message channel, not the opener). **The lead's "0 console errors" is therefore not accurate for Chromium after a click.** Record these two COOP messages as expected and known. No fix is required; optionally, say "Waiting for Google…" while busy.

**Live verdict:** the deployed candidate **matches the approved `a9d0e7e`**, and behaves as approved. P3s: the ~9 s cancel latency (COOP opener), and the shared Sign in spinner.

VERDICT: APPROVE
