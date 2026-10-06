# pqa-qa: full-E2E E-08 fix review (`31c2141`, pqa-be2). Dispute on a closed study

**The bug:** a dispute whose request time fell just inside the 7-day window (T0+W−1) could commit **after** a close that ran just outside it (T0+W+1). Overturning it then paid a `dispute_credit` from an already released study account, which minted 20 credits and broke the ledger invariant.

## The rule, checked against the domain
`closeStudyPlan` (`packages/domain/src/study.ts`) already **refuses** to close while any participation is `submitted` or `disputed`, **or** while a rejected one can still dispute (`canOpenDispute`, which applies inside the 7-day window). So a builder can't reject-then-close to strip recourse (`participation.ts`, comment and rule).

The race exists **only at the exact window boundary**: the close's clock says the window has ended, while the dispute's earlier request time still says it's open.

## The fix, as read
- **`openDispute`:** reads the study **in the same transaction** (`testerOwned` returns `s`) and refuses `CONFLICT_STATE` when `s.status === 'closed'`.
- **`resolveDispute`:** refuses `overturned` on a closed study; `upheld` is still allowed.
- **Both backends** (`repo/studies/{firestore,sqlite}.ts`).
- **Why it's race-safe on Firestore:** the close transaction reads the participations and writes the study; the dispute transaction reads the study and participation and writes the participation. These conflicting read/write sets are serialised.

## Answers to the lead's questions
1. **Is refusing an overturn on a closed study fair?** Yes.
   - With the new `openDispute` guard, a dispute can no longer **exist** on a closed study. A close is refused while one is open, and a dispute is refused once the study is closed.
   - So the overturn refusal is defence in depth that only affects **disputes opened before this fix** on closed studies. Upheld still resolves them cleanly.
   - The tester who "disputed in time" at the boundary loses only against a close that happened **after** the window, by the server's clock. The product promises a 7-day window, not more.
   - **Recommendation:** have the lead run a read-only production check that there are **0** `disputed` participations on `closed` studies. The source database had 0 disputes, and since the migration only labelled synthetic data exists.
2. **Any other path that pays from a closed study?**
   - **approve and reject:** need `submitted`, and close refuses while any is `submitted`.
   - **adminDecide (stuck):** the same `submitted` gate.
   - **dispute_credit:** only through an overturn, which is now refused on closed.
   - **Escrow payable:** escrow payout authorisation follows the same decision path, and the overturn refusal comes first. Close-vs-overturn and close-vs-last-approval escrow races are covered by the harness (E-07 rows), and refund-on-close is a single guarded refund.
   - I found **no** other path.
3. **Does it hold under the race, on both backends?**

| Run (mine) | Result |
|---|---|
| SQLite: `vitest run test/lifecycle.test.ts` at `31c2141` | **13/13** (includes the 2 new E-08 tests) |
| Firestore emulator, my ports (`firebase.emu-qa.json`): `regression.lifecycle.test.ts` plus be2's race harness `evidence/pqa-be2/harness/races.emulator.test.ts` (copied temporarily, import paths fixed, removed afterwards) | **26 passed, 2 skipped**, then the harness alone **16/16** |

  The harness's deterministic former repro now observes:
  ```
  {"afterClose":{"study":"closed","studyAcct":0,"builder":40},
   "disputeOnClosedStudy":"CONFLICT_STATE","overturn":"not attempted",
   "after":{"studyAcct":0,"builder":40,"tester":0},
   "studyBudgetView":{"reserved":40,"awarded":0,"committed":0,"available":0},"minted":0}
  ```

## Verdict
**APPROVE `31c2141`** for deploy. The ledger invariant holds, the race is closed on both backends, and the product rule is consistent with the 7-day window.

**P3:**
- **Production check:** the read-only check for `disputed` participations on `closed` studies, described above.
- **Clearer error copy:** a refused boundary dispute should say "The 7-day dispute window has ended and the study is closed", rather than only "closed".

VERDICT: APPROVE
