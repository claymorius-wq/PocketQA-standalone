# Freeze candidate: Phase 4, Gate A (app shell, flows, web preview)

- **Branch:** `feat/mobile`. Uncommitted until review. Base: `748bdd1`.
- **Author:** lead (`wX:p1`), solo mode.
- **Reviewer:** `pqa-qa`, read-only.

## Scope

`apps/mobile` is an Expo SDK 57 + Expo Router app (TypeScript), web preview first. All server data goes through `src/api/client.ts`, a typed client over the contracts route table that validates every response with the contract schema.

**Theme and UI kit.** System/light/dark tokens (`src/theme`), with the preference persisted. The UI kit in `src/ui/index.tsx` includes:

- Screen, Text, Card and Button (48dp minimum, real `disabled`/`aria-disabled`);
- Field, StatusPill, Notice, Segmented and Checkbox;
- a Modal-based ConfirmSheet instead of native alerts;
- QueryState, covering loading, error, offline, not-found and empty.

**Session.** Tokens are kept in SecureStore on native and sessionStorage on web, a web-preview-only tradeoff documented in `tokenStore.ts`. The root waits for session restore before rendering, and redirects signed-out users to sign-in from any protected route. Role tab groups redirect wrong roles.

**Screens by role.**

- **Tester:**
  - Discover: eligibility, plus a device-missing state.
  - Study detail: consent with a version, the reward disclaimer, and the recording capability.
  - Session: start, per-task notes, record (Android module, Phase 5) or attach. Segment review: preview, then keep or remove, then upload only kept items. Submit (locks), withdraw.
  - Decision view: approved, or rejected with reason. Dispute within the 7-day window. Findings from the builder.
  - My work, Credits, Settings.
- **Builder:**
  - Studies, and new study with a live banned-copy check.
  - Study detail: budget reserved, awarded, committed and available; publish, pause, resume and close with confirmation; participants.
  - Review: task notes, evidence via scoped playback token, "Analysis unavailable" card, findings, approve or reject.
  - Budget: local test top-up.
  - Settings.
- **Admin:**
  - Disputes: resolve, uphold or overturn.
  - Moderation: suspend or reinstate, with a reason.
  - Audit log.
  - Settings.
- **Settings:**
  - theme;
  - device profile (self-reported);
  - devnet wallet section (capability-gated, unavailable on web; the MWA link is Phase 6);
  - AI status;
  - export (downloads JSON on web);
  - delete account (typed confirmation);
  - sign out.

**Capability matrix** (`src/lib/capability.ts`). Recording requires Android 10+ and the native module. Wallet linking (MWA) is Android only.

**Device-side segment store and uploader** (`src/evidence/segments.ts`): uses the domain `uploadQueue` and `transitionSegment`.

## Bugs found and fixed while testing (with regression evidence)

1. **Stale dev bundle.** Metro's watcher didn't pick up edits in this environment, so early E2E passes ran against old code. Those runs are **discarded**. E2E now builds a fresh `expo export --platform web` static bundle on every run (`playwright.config.ts` webServer, served by `e2e/serve-web.mjs` on 127.0.0.1:8090).
2. **Discover stayed stale after a device-profile change.** Tabs stay mounted. Fix: invalidate eligibility on device save, and refetch lists on focus.
3. **Infinite refetch loop.** My first `useFocusRefetch` depended on the query object. Regression test `__tests__/focus-refetch.test.tsx`: with the old dependency, `Expected number of calls: 0 / Received number of calls: 5`. Fixed: passes.
4. **Buttons not semantically disabled on web.** The consent button stayed clickable for assistive tech and automation. Now `disabled` + `aria-disabled`.
5. **Requests before session restore after a reload.** These returned "Sign in to continue" on the builder study page. The root now gates rendering on `ready`.
6. **A closed ConfirmSheet stayed mounted and visible on web.** react-native-web's fade-out Modal stayed in the DOM: after resolving a dispute, the "Resolve dispute" sheet was still laid out (opacity 1, visible) when the moderation sheet opened. Found by `e2e/admin-dispute.spec.ts` as a strict-mode violation on two `confirm-ok` buttons. Fix: the sheet unmounts when closed.

## Commands and results (actual output in this folder)

- `pnpm verify` → EXIT=0 (`pnpm-verify.txt`).
  - Secrets: 166 files clean (round 2).
  - Scanner 7/7, contracts 14/14, domain 156/156, api 238/238.
  - **mobile jest: 5 suites, 95 tests.** These cover the contrast pairs in both themes (text ≥ 4.5:1, UI ≥ 3:1), the upload queue (removed or unreviewed segments are never sent), the capability matrix, the banned-copy scan over every app/src string literal, and focus-refetch.
- `cd apps/mobile && npx playwright test` → **4 passed** (`playwright.txt`). Playwright now starts its own API on 127.0.0.1:8787 with a throwaway data dir, plus a fresh static web export. The tests:
  1. **Full review loop**, with two browser contexts (builder in light, tester in dark):
     - Builder: empty state; top-up 0 → 1,000; banned objective blocked live, then cleared; draft; publish (reserved 100).
     - Tester: no-device state, then device saved; wallet-unavailable notice on web; study card; reward disclaimer "Not guaranteed"; recording-unavailable; consent button disabled until the box is checked; consent; start; note saved.
     - Evidence: a **private screenshot attached then removed**. Another attached, with no upload button until kept; keep; upload ("Uploaded (1)"); submit (status "Awaiting review").
     - Builder review: sees the note and "Analysis unavailable"; **exactly 1 evidence item** (the removed one never reached the server); views the image via playback token; adds a finding; approves.
     - Tester: sees "50 test credits" approval and the finding; Credits balance "50 test credits". Builder: budget awarded 50.
  2. **Theme and auth:** an unauthenticated deep link to `/studies` lands on sign-in. The dark override sets background `rgb(13, 13, 15)` and persists across reload.
  3. **Offline:** API requests aborted, which shows the offline state; Retry recovers to the empty state.
  4. **Admin dispute** (`admin-dispute.spec.ts`):
     - The admin is created through the real `admin:create` CLI, with the password piped on stdin.
     - A builder rejection with a too-short reason is blocked (confirm disabled).
     - Close is blocked inside the dispute window. The in-sheet error shows "dispute window".
     - The tester disputes, and the admin sees the dispute with its rejection context, then overturns it.
     - Moderation suspend is entered with a reason. The audit shows `study.suspend` then `dispute.overturned`.
     - The tester's balance is "50 test credits", with exactly one `dispute_credit` entry.
- Screenshots: `docs/reviews/gate-a/*.png`, including admin disputes/audit and the tester dispute flow.

## Not covered here (truthful)

- **Android native build and on-device runs** are Phase 5. The recorder module isn't built yet, so on Android the capability reports "This build doesn't include the screen recorder".
- **The MWA wallet link is Phase 6.** `src/wallet/link.ts` throws "isn't built into this version yet". It never fakes a link.
- **iOS** was not run. It's a graceful-degradation target only.

## Round 2: fixes for `verdict-qa-r1.md`

**P1: a removed segment could upload during an in-flight upload.**
- Test first: a new `upload-queue.test.ts` case starts the upload of A, removes B while A is pending, then releases A. It ran **red** (`1 failed, 3 passed`) against the snapshot uploader.
- Fix:
  - `uploadKept(get, upload, update)` now re-reads the live list before each item and skips anything not kept or failed.
  - Every transition is a functional update, so the uploader never overwrites a concurrent removal.
  - In the screen, a ref is the source of truth and every mutation goes through `update`.
- Result: green (`4 passed`).

**P3 fixes:**

| # | Fix |
|---|---|
| 2 | Submit is disabled with a "Evidence not uploaded yet" notice while recorded, kept, failed or uploading items exist. Local copies of unsent items are deleted on unmount. E2E asserts the notice and the disabled submit, then their absence after upload. |
| 3 | `FORBIDDEN_ROLE` renders a distinct "Not allowed" state (`forbidden-state`) with no Retry. |
| 4 | `RequireRole` guards `/builder/*` (builder) and `/study/*`, `/participation/*` (tester). E2E: a tester deep-linking to `/builder/new-study` lands on Discover. |
| 5 | Theme colors added to the Sparkles, ShieldCheck, Wallet and Smartphone icons. |
| 6 | Evidence `Image` uses `cachePolicy="none"`. |
| 7 | Findings link evidence by explicit choice (None / #n). |
| 8 | Secrets count corrected. `serve-web.mjs` checks `root + sep`. RNTL and react-native-web are pinned exactly, and the mobile dependency table is in `dependency-versions.md`. |

**Results:**
- `pnpm verify` EXIT=0: mobile 97/97, api 238/238, domain 156/156, contracts 14/14, secrets 166 files clean.
- Playwright: 4 passed (`playwright.txt`).

## Round 3: post-approval P3 fixes (`verdict-qa-r2.md`)

- **New P3 #1:** new `removeSegment(list, id, deleteLocal)`. It refuses to remove anything that isn't recorded, kept or failed, and deletes the local copy only after the transition succeeds. Test: it ran red (`1 failed, 5 passed`), then green.
- **New P3 #2:** unmount sets a `cancelled` ref. The uploader's `get()` then returns `[]`, so the remaining items are skipped. Test: "stops uploading remaining items once cancelled".
- **Results:** `pnpm verify` EXIT=0 with mobile 99/99. Playwright 4 passed.
