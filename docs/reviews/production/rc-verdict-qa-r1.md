# pqa-qa verdict: integrated release candidate, r1 (fresh full review; security and product)

**Candidate:** `6c8bec04799d79f1cc8f28535a6f3dd84d692096` on `feat/production-readiness`, a clean tree.

**Range reviewed:** `06c09b3..6c8bec0`:
- the merge `94774d1`, which brings in `origin/main` `4bd307a` (Lens), with the production behaviour re-applied;
- `6c8bec0`: the native Lens crash fixes N-1 to N-4, the restore fixes P2-1 and P2-2, and increment 5.

The context is the whole branch `9461db5..HEAD`. **No earlier approval is reused.** `freeze-verdict-qa-r1` and my interim API reviews were treated only as background.

**Rules held:**
- No commits, no edits to implementation files and no index changes. The tree was clean before and after.
- **No cloud mutation by me:** I made no R2 or Firebase calls, and the CORS state is taken from the lead's evidence file.
- I didn't read `.cloud-local/`, `.env*`, `.preview*` or `preview-data`.
- No subagents and no advisor.
- **Emulator:** I used the AVD `emulator-5554` only while it was idle, as the brief allowed. I used a throwaway API in my scratchpad and removed my `adb reverse` afterwards.

## What I ran (Node v24.21.0, on `6c8bec0`)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets` scanned 726 files with no findings. Test counts: scripts 47, contracts 17, domain 170, API 376 passed plus 2 skipped, mobile 1018. These match the candidate |
| Playwright (`apps/mobile`) | **14/14**, PW_EXIT=0. Screenshots restored, tree clean |
| `pnpm test:e2e:firebase` (local Auth emulator) | **4/4** |
| `PROD_API_URL=/api bash scripts/production/build-web.sh` | EXIT=0; secret check 0 values in 29 files |
| `git diff 9461db5 HEAD -- scripts/preview` | empty: the demo preview's scripts are untouched across the whole branch |
| Branch grep for added R2 deletion or lifecycle paths | only the jest keystore mock (`deleteItemAsync`). The only new bucket call is `PutBucketCors` in the reviewed `r2:cors` tool |
| **Installed APK on `emulator-5554`** (pulled and hashed) | sha256 `6f9208cd3889ccb2…`, the candidate's final APK |
| **Android EMULATOR, my own run of the crash-related flows** on that APK (local dev API in my scratchpad; seeds from `seed.mjs`) | **record-consent EXIT=0** (N-1, recording start); **record-decline EXIT=0** (N-3); **sign-out EXIT=0** (N-2); **sheet-keyboard EXIT=0** (N-2, account deletion). `active_projections=0` after each. Crash buffer: **0** Pocket QA or FATAL lines. Main log: **0** `Maximum update depth` or `ReferenceError` lines |

My first attempt at that native run failed, through **my own scripting error**: the flow path was wrong, `Flow path does not exist`, and nothing ran on the device. I reran it correctly, and the results above come from the rerun.

**Not run by me:**
- the full 12-flow suite, including wallet-decline and wallet-link, which need the test AVD PIN I don't hold;
- the MWA login flows and firebase-persistence;
- the iOS simulator flows (N-4).

I inspected the lead's evidence for those (`rc-native-*`, `rc-ios-*`); they're labelled emulator, simulator and mock wallet only.

## Merge `94774d1`: production behaviour on the Lens screens
- **`sign-in.tsx`** has all of these:
  - hero copy based on `features.testCredits`;
  - Forgot password and Resend verification;
  - discarding an unverified session;
  - a `useWallets` button per wallet;
  - Android MWA sign-in;
  - "unreachable" for production;
  - the demo picker gated by `PREVIEW_BUILD`.
- **`_layout.tsx`** keeps `DEPLOYMENT_PROBLEM`.
- **Every top-up or transfer entry point is gated:**
  - the `TransferCard`s at `builder/review/[id].tsx:194` and `participation/[id].tsx:543` check `features.devnetTransfers`;
  - `CreditsScreen` shows the funding-unavailable notice when `!features.testCredits`;
  - the only `topUp` call is behind that check;
  - the server still refuses both with `FEATURE_UNAVAILABLE`.

## `6c8bec0`
- **N-1:** the worklet's default parameter moves into the body. The static guard `worklets.test.ts` catches the old form.
- **N-2:**
  - The root `Stack` stays mounted, and every signed-out redirect targets `/sign-in`.
  - **Every route outside `(auth)` guards itself:**
    - the tab groups through `RoleTabs` in their `_layout`;
    - `builder/*`, `study/[id]` and `participation/[id]` through `RequireRole`, which redirects to `/sign-in` when signed out;
    - `index` redirects to `/sign-in`.
  - So removing the root redirect exposes no screen, and the API enforces authorization anyway.
  - Three navigation tests plus `sign-out.yaml`, which **I ran green**.
- **N-3:** the evidence error moves above the recorder. **I ran it green.**
- **N-4:** `automaticallyAdjustKeyboardInsets`, plus Sign in scrolls to its end when the keyboard shows. iOS only in effect; not run by me.
- **Lens P3-5 and P3-6:** sheet fields `locked` while pending, and the top-up bound to the tapped amount (unit test). P3-1 `focusFloor` is web only; the focus spec is in Playwright's 14.
- **Restore:**
  - the sidecar naming plus checkpoint fixes P2-1;
  - try/catch, a warning and continuing fix P2-2;
  - the `unfinishedRestore` guard in `server.ts` runs before `openDb`;
  - the P3-3 wording is now honest ("SQLite may have rewritten or dropped damaged parts").
  
  This matches what I verified in the interim r2 and r3 probes, and the tests pass in `verify`.
- **The `user.deleted` audit row and `db:deleted-since`:** as reviewed; tests pass.
- **CORS applied, from the lead's evidence:**
  - the tool hashes `91183774…` and `4fc50c07…` are unchanged;
  - `r2-cors-apply.txt` shows before (none), then create, with a matching readback;
  - preflight: PUT from the origin 204, from `evil.example` 403, GET 403.
  
  It is one rule, PUT only, on `pocketqa-evidence` only, and no object was touched. Ledger S3 ✅ rests on that evidence. **I did not re-probe it live**, per the no-cloud rule.
- **Evidence hygiene:** the earlier `inc2-native` command logs were edited only to redact the seeded emulator test password (`<redacted>`). No other content changed.

## Findings (all P3, non-blocking)
1. **The tester's dispute reason field isn't locked while sending** (`participation/[id].tsx`, `dispute-reason`). That's the same class as Lens P3-5, though that list didn't include it. Add `locked={dispute.isPending}` for consistency.
2. **Carried advisories, still open and tied to A5:**
   - P3-2: an operator `db:redelete`;
   - P3-3: a byte-exact raw copy of a corrupt kept DB before opening it.
3. **The CORS state is evidenced only by the lead's run.** Before cutover, the parent should re-run the read-only dry run (`r2:cors --origin … `, which prints `plan: same`) on the host and record it.

## Gates still open (honest, unchanged)
- **Firebase Auth isn't initialised:** `CONFIGURATION_NOT_FOUND` (access action A1). The dedicated service account is A2, and the bucket-scoped R2 token is A3.
- **Hamza's decisions:** deletion policy A5 (production can't start), funding A9, wallet risk acceptance A8, and privacy policy B4.
- **No physical device, no real browser or MWA wallet, no release signing:** N2, W5, W6, A6, I9 and S6.
- **The production host install and its restore drill:** A7.

All native evidence, mine and the lead's, is emulator, simulator or mock wallet only.

VERDICT: APPROVE
