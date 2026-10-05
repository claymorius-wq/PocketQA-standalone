# pqa-qa verdict: wallet-rewards export, r4 (exact-candidate confirmation)

**Candidate:** `2b069b0` (`feat/wallet-rewards`), reviewed as `git diff 90506e9..2b069b0`: 12 files, 1 commit. My r3 approval covered `90506e9`. This commit applies only my two r3 P3s.

**Reviewer setup:**
- I ran everything in my own detached worktree `.worktrees/qa-wr-run`, checked out at `2b069b0`. The lead's worktree was not touched.
- No cloud or devnet calls, no subagents, no advisor. The tree was clean afterwards.

## Delta confirmed
- **Code:** only `apps/api/src/handlers/account.ts` changed (+3/−1). `exportMe` now returns `participations: parts.map((p) => ({ ...participationView(…), payout: null }))`.
  - So the reward appears once, in `payments.received`, as exact string units, with no retry internals.
  - `payout` is `Payout.nullable()` in the contract (`packages/contracts/src/index.ts:341`), so the bundle still parses.
- **Tests:** `apps/api/test/export-wallet.test.ts` (+14).
  - **Tester:** no `/"(amountUnits|feeUnits)":\s*\d/` anywhere, no `attempts?"`, and every `participations[].payout` is null.
  - **Builder:** the setup now **creates a finding** on a tester's participation. It asserts no tester wallet, email or user id anywhere in the export, `findings` with length 1, and **no participation id inside `payments`**.
- **Docs and evidence:**
  - the README notes that builder findings keep their participation id (pre-existing, the builder's own record);
  - the `pnpm-verify.txt` refresh;
  - re-captured browser screenshots;
  - `qa-wallet-rewards-export-verdict-r3.md` copied into the branch, **byte-identical** to my file (`diff` empty).
- Nothing else changed.

## What I ran (Node v24.21.0, at `2b069b0`)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets`: 815 files, no findings. Scripts 58; contracts 17; domain 216; API 479 passed plus 2 skipped; mobile 1069 |
| `npx vitest run test/export-wallet.test.ts` | **5/5** |
| Playwright `e2e/wallet-rewards.spec.ts` (downloads both exports through Settings) | **1/1** passed. The screenshots were restored, and the tree is clean |

## r3 findings
| r3 | Status |
|---|---|
| **P3-1:** a numeric duplicate of the payout in `participations[]` | **fixed.** The payout is null in the export, and the reward appears once as a string (asserted) |
| **P3-2:** the builder participation-id claim is broader than its test | **fixed.** The test now includes a finding, and the claim is scoped to "no tester wallet, email or user id; no participation id in money rows". The pre-existing finding participation id is documented |

## Verdict
`2b069b0` applies exactly the two r3 P3 fixes, with tests, and nothing else changed. All gates pass. This approval covers exactly `2b069b0` for the export change. The local-slice scope and the provider activation gates from my earlier verdicts still apply.

VERDICT: APPROVE
