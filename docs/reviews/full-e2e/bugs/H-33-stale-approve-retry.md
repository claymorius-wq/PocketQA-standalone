# H-33: a review screen whose approve was already committed elsewhere stays stale after the 409

**Severity:** P3 (UX). Money-safe: the server refuses the second approve (409 CONFLICT_STATE), and exactly one reward is credited.
**Found by:** pqa-be1, full E2E (QA CH-3), 2026-10-06T19:22Z, live `dpl_GPVCsNcfhQ6RufakYjqA18GmUkBX` (bundle `entry-d9b5472d…`), environment hosted-simulated.

## Repro (synthetic accounts and studies only)
1. Builder "QA synthetic builder (hosted)" signs in in tab 1 and, separately, in tab 2. Web sessions are tab-scoped by design (`apps/mobile/src/auth/firebaseClient.ts:31`).
2. Both tabs open `/builder/review/<participation>` for a submitted participation (study "QA synthetic study be1 H2", participation `a1f82747-d0ce-4d8c-bf90-25f5faca63f4`).
3. Tab 2: press Approve, which opens the "Approve and credit 40 test credits?" sheet. Leave it open.
4. Tab 1: Approve, then confirm. `POST /approve` → 200, and the tester is credited +40.
5. Tab 2: confirm Approve.

## Expected
The 409 is recognised as "already decided": the sheet closes, the screen refetches and shows the decided state ("Decision: Approved …"), and no Approve action is offered any more.

## Observed
- `POST /approve` → 409, then tab 2 GETs the participation, evidence and findings (200).
- The sheet stays open with "Decision not saved · Cannot approve a participation that is approved." and an active Approve button.
- The page behind still shows "AWAITING REVIEW", 4 s later too.
- Only a manual reload shows "Status: APPROVED · Decision: Approved · Decided Oct 6, 9:22 PM" with no Approve button.
- The tester's balance went 90 → 130: exactly one +40 for this participation.

## Evidence
`docs/reviews/full-e2e/evidence/pqa-be1/50-ch3-tab2-after-retry.png`, `51-ch3-tab2-after-reload.png`, `hosted-run-results.json` (key `p10`: `tab2`, `tab2Later`, `tab2AfterReload`, `ledger`).

## Suggested fix (not implemented here)
In the review screen's decide mutation `onError`: for `CONFLICT_STATE`, close the sheet, invalidate and refetch the participation query, and show a neutral "Already decided" notice instead of the error.
