# Repository conventions (docs/plans/firebase-vercel-refactor.md §2, r2)

1. **Interface first** (`<domain>/types.ts`): async, intent-level operations (`claimSlot`, `awardReward`, …), never "run this SQL". Rows keep today's shapes (`StudyRow`, …) so views and contracts don't change.
2. **`sqlite.ts`**: move today's SQL out of the handlers verbatim. A multi-statement operation keeps its `db.transaction(...)` *inside* the method. Return promises. Behaviour must not change: the existing API suite stays green on SQLite at every commit.
3. **`firestore.ts`**: native Firestore.
   - Every UNIQUE constraint goes through `claimGuard` (src/firestore/tx.ts) with the guard doc id from the plan r2 §R2 table, in the **same** `runTx`.
   - All reads come before writes.
   - **No side effects in a transaction callback** (no R2, chain, network, logging of effects); do them after `runTx` returns.
   - Deterministic ids where the plan says so.
4. **Handlers** call `ctx.deps.repo.<domain>.<op>(...)` and do side effects after it returns. **Views** (`src/views/<domain>.ts`) become async and take `repo`, not `db`.
5. **Tests:**
   - the domain's emulator tests live in `test/emulator/<domain>.*.test.ts` (run: `pnpm test:emulator`), with ≥ 20-way races for each guard in the plan table and a forced-retry test where effects exist;
   - during development, run only your own test files;
   - the lead runs the full suites.
6. **Git:**
   - commit only your own folder and files (`git add <your paths>`; never `git add -A`); retry if `index.lock` exists;
   - no installs (ask the lead), no cloud, Firebase or Vercel commands, no `pnpm verify`.
