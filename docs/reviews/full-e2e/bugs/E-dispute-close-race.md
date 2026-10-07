# E-08: a dispute opens on a closed study at the 7-day boundary, and its overturn pays from the released budget (double settlement)

Found by pqa-be2 (claude-opus-5-5), full E2E 2026-10-06.

- **Environments:** `emulator` (Firestore repo, the hosted code path) and the SQLite repository (the local/USB API's backend).
- **Source state:** API source was identical to the frozen `7beaad5` when found.
- **Money:** test credits and simulated settlement only, so no money moved.

Status: **FAIL** on the frozen candidate. The fix is committed on `feat/firebase-vercel` (SHA in the lead report) and awaits review and deploy.

## Root cause
- **`openDispute` never checks the study.** Both `apps/api/src/repo/studies/firestore.ts` and `apps/api/src/repo/studies/sqlite.ts` check only the participation status and `canOpenDispute(decidedAt, now)`. They never read `study.status`.
- **Two clocks decide the boundary.**
  - `closeStudyPlan` (`packages/domain/src/study.ts:41`) refuses to close while a rejected tester can still dispute, judged at the **builder's** request time.
  - The dispute is judged at the **tester's** request time.
  - Each is `deps.now()` taken at handler start, before its transaction.
  - So a dispute received just before the window ends can commit after a close received just after it, on one server clock as well as across instances.
- **The overturn pays anyway.** `resolveDispute` (overturned) adds the participation's own hold back (`available + p.reward_credits`) even on a closed study. A closed study has 0 committed and 0 available after the release, so `planReward` passes and posts study → tester from a 0-balance study account.
- **Upheld is not affected.** An upheld dispute posts nothing.

## Repro
1. Reward 20 × 2 slots (40 reserved). Tester submits, builder rejects at T0.
2. Builder closes at T0+7d+1ms.
3. The tester's dispute, timed T0+7d−1ms, commits.
4. An admin overturns.

Harness: `docs/reviews/full-e2e/evidence/pqa-be2/harness/races.emulator.test.ts` (the "boundary" and "BUG repro" tests) and `harness/e08.sqlite.test.ts`.

## Expected
A closed study refuses new disputes, and an overturn never pays from a closed study. Builder + tester never exceed the 40 funded, and the study account is never negative.

## Observed (before the fix)
- **Emulator, deterministic** (`evidence/pqa-be2/E-races-run2.txt`):
  - After close: study `closed`, study account 0, builder 40.
  - Dispute: `opened`. Overturn: `ok`.
  - After: study account **−20**, builder 40, tester 20 (`dispute_credit` 20). **20 minted.**
  - `studyBudget` for the study throws `INTERNAL: Ledger invariant violated: study budget over-committed.`, so the builder's study view breaks.
- **Emulator, race:** 10 disputes at T0+W−1 and 10 closes at T0+W+1, run concurrently. All **5/5 trials** ended `close+dispute`: both committed, with 1 dispute on a closed study.
- **SQLite** (`evidence/pqa-be2/E-08-sqlite.txt`): same values (study account −20, builder 40, tester 20, 20 minted). No DB trigger refuses it.

## Impact
- On the frozen deployment this is test credits only.
- A closed study's reserve is paid twice, and the study account goes negative.
- The study budget view throws INTERNAL.
- The window is narrow (milliseconds around the 7-day boundary).
- With real escrow, the same ordering would be refund-then-payout. The fix also guards that path: the overturn check sits before the escrow branch.

## Fix (test first)
- `openDispute`, both backends: refuse with `CONFLICT_STATE` "This study is closed, so its decisions can no longer be disputed." A close that committed first wins.
- `resolveDispute`, overturned, both backends: refuse with `CONFLICT_STATE` on a closed study, so nothing is ever paid from a released budget. Upheld stays possible, so an existing dispute can still be closed out.
- Tests in `apps/api/test/lifecycle.test.ts`, which run on SQLite and on Firestore via `regression.lifecycle`:
  - "a dispute timed before a close that committed first is refused on the closed study; nothing is paid twice"
  - "an overturn never pays from a closed study (a dispute left open on one is refused, not credited)"
- Red then green on both backends: `evidence/pqa-be2/E-08-fix-red-green.txt`.

## Data check for the live deployment (not done by pqa-be2; read-only, lead's call)
Look for any `disputes` row whose study is `closed` and whose `created_at` is later than the study's `closed_at`. Any such dispute that was overturned left a negative `study:<id>` account.
