# pqa-qa verdict: integrated release candidate, r2 (delta review of the final commit)

**Final candidate:** `63ac24f89e13c94dc9ce0cbad8f324dac33d9232` on `feat/production-readiness`, a clean tree.

**Base of this delta:** `6c8bec0`, fully reviewed in `rc-verdict-qa-r1.md` (APPROVE). This round covers only `6c8bec0..63ac24f`, one commit, with no scope expansion.

**Rules held:**
- read-only: no commits and no edits to implementation files;
- no cloud calls, no emulator use, no subagents and no advisor.

## Delta confirmed (`git diff --stat 6c8bec0 63ac24f`: 6 files)
| File | Change | Check |
|---|---|---|
| `apps/mobile/app/participation/[id].tsx` | one prop: `locked={dispute.isPending}` on the `dispute-reason` Field | the only implementation change, matching the rc-r1 P3-1 fix |
| `apps/mobile/__tests__/participation-session.test.tsx` | +14 lines: "rejected: the dispute reason locks while it is being sent". It holds the request, then checks `editable` goes from `true` to `false` | a real assertion on the behaviour |
| `docs/reviews/production/rc-verdict-qa-r1.md` | my r1 verdict, committed as written | as-is |
| `docs/reviews/release/qa-ledger.md` | my rc-r1 row, committed as written (+1 line) | as-is |
| `docs/reviews/production/pr-body.md` | a "Review of the integrated candidate" section | accurate. It says the native APK `6f9208cd…` and iOS bundle `a9f23a2f…` were built from `6c8bec0`, not this follow-up, and lists the carried P3s and the CORS dry-run step for cutover. Nothing is claimed beyond the evidence |
| `docs/reviews/production/rc-final-pnpm-verify.txt` | the lead's verify log | consistent with my run below |

No other file changed. `apps/api`, `packages`, `scripts` and `scripts/preview` are untouched in the delta.

## What I ran on `63ac24f` (Node v24.21.0)
- **Before committing,** on the identical working-tree change: `npx jest __tests__/participation-session.test.tsx` passed 22/22, including the new test.
- **`pnpm verify`:** **EXIT=0**.
  - `check:secrets` scanned 728 files with no findings.
  - Script tests: 47.
  - Test counts: contracts 17, domain 170, API 376 passed plus 2 skipped, **mobile 1019** (up 1, the new test).
  
  The tree was clean before and after.

## Carry-over from rc r1, unchanged by this delta
- The rc-r1 evidence still holds for everything except the one changed prop:
  - Playwright 14/14, Firebase E2E 4/4, the web export, the preview untouched, and no new delete path;
  - my emulator run of record-consent, record-decline, sign-out and sheet-keyboard on APK `6f9208cd…`.
- **The native binaries weren't rebuilt for this commit.** The change is one prop on a React Native `Field`, covered by the unit test. A rebuilt APK isn't required for this verdict, but cutover installs should be built from `63ac24f`.
- **P3s still open, tied to A5:** `db:redelete`, and a raw byte copy of a corrupt kept DB.
- **At cutover:** re-run `r2:cors` as a read-only dry run.

## Gates still open (honest, unchanged)
- **Firebase Auth isn't initialised** (access action A1); there's no dedicated service account (A2) and no bucket-scoped R2 token (A3).
- **Hamza's decisions:** deletion policy A5 (production can't start), funding A9, wallet risk acceptance A8, and privacy policy B4.
- **No physical device, real wallet or release signing.**
- **The production host install and its drill** (A7).

All native evidence is emulator, simulator or mock wallet only.

This approval covers exactly `63ac24f89e13c94dc9ce0cbad8f324dac33d9232`. Any later change needs a new review.

VERDICT: APPROVE
