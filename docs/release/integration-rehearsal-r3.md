# Release integration rehearsal r3 (LOCAL ONLY)

pqa-be2, 2026-10-07 (Hamza GO: deploy + final APK). Branch `release/integration-r3` from `release/integration-r2` **87373b2** (r2 = main daf0c85 + fv fb3f3bf + demo-showcase a364b08 + P-13 27608e9; see integration-rehearsal-r2.md). Worktree `.worktrees/release-integration-r3`.
**No push, no PR, no remote write, no other branch changed, no deletions.** r1/r2 are kept as they were.

## Merges in r3

| Slot | Branch | Pinned SHA | Status |
|---|---|---|---|
| (a) | `fix/keyboard-inset` | **4fe34d1** | merged (`--no-ff`) |
| (b) | `fix/demo-cap-10` (pqa-be3) | c4e29c5 at the time of writing | **slot left open: not ready yet**, not merged |

What 4fe34d1 carries (`git merge-base --is-ancestor <c> 4fe34d1`):
- `fix/android-icon` 388ede9 … c39828b. **Not its head 11131bf**: that commit only adds `docs/reviews/android-icon/clip-preservation.md` (44 lines, docs). It isn't in 4fe34d1, so it isn't in r3; merge it separately if wanted.
- `fix/preserve-clips` ea5f2f8, bec9671 … 6cacd7b (its head);
- `fix/device-profile-native` 8f10e86, 622581d, 643541a, 8b81ca8 (its head);
- the keyboard fix 4fe34d1.
- P-13 27608e9 is NOT in 4fe34d1; it comes from r2.

## Read-only pre-check

```
$ git merge-tree --write-tree --name-only 87373b2 4fe34d1
d3c00b83730a0fa8218fef12271f599bc6b84610
exit 0
$ git merge-base 87373b2 4fe34d1
2124b70
$ comm -12 <(git diff --name-only 2124b70 87373b2 | sort) <(git diff --name-only 2124b70 4fe34d1 | sort)   # files changed on BOTH sides
apps/mobile/src/auth/SessionProvider.tsx
apps/mobile/src/lib/queries.ts
modules/screen-capture/android/src/main/java/expo/modules/pocketqascreencapture/ScreenCaptureModule.kt
modules/screen-capture/android/src/main/java/expo/modules/pocketqascreencapture/ScreenCaptureService.kt
packages/contracts/src/index.ts
```

**DIFFERS FROM THE EXPECTATION: no textual conflict.**
- The expected conflicts in SessionProvider.tsx, queries.ts and contracts index.ts don't occur: their hunks don't overlap, so git's three-way merge combines them.
- `discover.tsx` and `app.json` (versionCode) are changed ONLY on the keyboard-inset side, so they can't conflict.
- The two screen-capture Kotlin files (P-13 via r2 + preserve-clips via 4fe34d1) also auto-merge.

## Merge (exact command) and the per-file verification

```
$ git worktree add -b release/integration-r3 .worktrees/release-integration-r3 87373b2
$ git merge --no-ff --no-commit 4fe34d1        # "Automatic merge went well; stopped before committing as requested"
$ git write-tree                               # d3c00b83730a0fa8218fef12271f599bc6b84610 (= the simulation)
$ git commit -m "Merge fix/keyboard-inset 4fe34d1 into release/integration-r3 (...)"   # body explains each file (below)
```

**Behaviour check for the five both-sides files:**
1. **Every line r2 added** (`git diff 2124b70 87373b2 -- <file>`, "+" lines) is still present in the merged file: SessionProvider 1/1, queries 2/2, contracts 117/117, ScreenCaptureModule.kt 87/87, ScreenCaptureService.kt 54/54. That covers the demo-showcase/devnet session and query bits, the devnet contracts and the P-13 fix.
2. **keyboard-inset's side is applied** (`git diff 87373b2 a51188b -- <file>`):
   - SessionProvider: preserve-clips `clear()` → `endSession(opts)`, with native clips deleted only with `deleteRecordings` after the tester confirms; device-profile `switchUser` (a change of user clears the query cache); an offline start keeps the session.
   - queries: `useEligible(userId)` scoped by user, plus `useAppFocus` (refetch on resume).
   - contracts: an Android device profile requires its API level.
   - Kotlin: never delete a recording automatically.
3. **Typecheck and the full mobile/api/contracts suites pass on the merged tree** (below). That covers the semantic seams the textual merge can't see: r2 call sites of the renamed `clear`/`endSession`, of `useEligible(userId)`, and of the stricter device-profile contract.

| Step | Commit | Tree |
|---|---|---|
| r3 base | 87373b2 (= r2 HEAD) | |
| (a) merge fix/keyboard-inset 4fe34d1 | **`a51188b9ad1226d2bebc4995f2aa770e42f7b14c`** | **`d3c00b83730a0fa8218fef12271f599bc6b84610`** |
| (b) fix/demo-cap-10 | open slot | |

## Gates on the merged tree (Node v24.21.0; chained with `&&`, no pipes; clean before and after)

`pnpm install --offline --frozen-lockfile` → "Done in 5.8s".

```
pnpm check:secrets && pnpm lint && pnpm typecheck \
 && pnpm --filter @pocket-qa/api exec vitest run --maxWorkers=2 \
 && pnpm --filter @pocket-qa/mobile exec jest --ci -w 2 \
 && pnpm --filter @pocket-qa/contracts exec vitest run --maxWorkers=2 \
 && pnpm --filter @pocket-qa/domain exec vitest run --coverage --maxWorkers=2 \
 && node --test --test-concurrency=2 scripts/*.test.mjs        # chain exit 0
```

| Gate | Result |
|---|---|
| check:secrets | "check:secrets passed: 1697 committable files scanned, no findings." |
| lint | exit 0, no problems |
| typecheck | exit 0 |
| api unit | Test Files 54 passed, 1 skipped (55); Tests 846 passed, 2 skipped (848) |
| mobile jest (-w 2) | Test Suites 75 passed (75); Tests 1512 passed (1512) |
| contracts | Test Files 2 passed; Tests 17 passed |
| domain | Test Files 18 passed; Tests 301 passed |
| scripts | tests 93, pass 93, fail 0 |

**Not run in r3 (not requested):**
- the API emulator suites: the merge changes server code (the Android device profile's API level is now required), so run them before release if the deploy gate needs it;
- the screen-capture Kotlin JVM tests (CaptureStartTest etc.);
- any on-device check of the merged APK.

Nothing was started on 8787 or 8697; PID 28574 was not touched. Log (local, not committed): `~/.local/share/pocketqa/runs/release-integration-r3-gates.log`.

## Replay
1. From r2's replay result, run `git merge-tree --write-tree 87373b2 4fe34d1`. Expect exit 0 and tree d3c00b8… if the heads are unchanged.
2. `git merge --no-ff 4fe34d1`, then re-run the gate chain.
3. Slot (b) fix/demo-cap-10: merge-tree first, merge, re-run the gates, and update this document as r3b/r4.
