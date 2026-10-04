# pqa-qa verdict: wallet-rewards export, r3

**Candidate:** `90506e9` (`feat/wallet-rewards`), reviewed as `git diff 919952a..90506e9`: 32 files. `919952a` itself is docs-only, after my r2 approval of `0659ffb`.

**The parent's request:**
- export the payment and reputation data, under TDD;
- least data, own data only, no cross-account leaks;
- exact string token units;
- no secrets or provider-private fields;
- no new cloud or deletion behaviour;
- redact the emulator `oobCode` and `apiKey` values;
- document the fraud consequences and the frozen wallet.

**Reviewer setup:**
- I ran everything in my own detached worktree `.worktrees/qa-wr-run`, checked out at `90506e9`. The lead's worktree was not touched.
- No cloud or devnet calls, no subagents, no advisor.
- A scratch probe existed only in my run worktree and was deleted afterwards. Its tree is clean.

## What I ran (Node v24.21.0, at `90506e9`)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets`: 814 files, no findings. Scripts **58** (including the new `evidence-redaction.test.mjs`); contracts 17; domain 216; API **479** passed plus 2 skipped; mobile 1069 |
| Playwright `e2e/wallet-rewards.spec.ts` (downloads both exports through Settings) | **1/1** passed. The screenshots were restored, and the tree is clean |
| **Redaction** of the 9 changed Firebase logs | **0** unredacted `oobCode=` values, **0** unredacted `apiKey=` or `key=` values, **0** `fake-api-key` remaining; 33 × `oobCode=[REDACTED]`. **The pass counts are identical before and after in all 9 files** (`2 passed` ×3, `4 passed` ×6), as are the result line counts. The guard test scans every `docs/**/*.txt` |
| **PROBE-6** (my own): a builder export after an escrow approval, **a builder-authored finding on the tester's participation**, and a test-credit study approval | **Parses** (`ExportBundle`). Tester wallet **absent**, tester email **absent**, tester user id **absent**. The tester's participation id appears **only in `findings`**, the pre-existing section: the builder's own finding, keyed by participation |
| **PROBE-6b:** tester export | **Parses.** `payments.received[].amountUnits` is `"1000000"` (a string). But `participations[].payout.amountUnits` is `1000000` (a **number**), and it also carries `attempts` (P3-1) |

## Checks against the request
- **Least data and own data only.**
  - The tester's `received` lists only their own payouts (`tester_id = ?`), to their frozen wallet.
  - The builder's `fundings`, `refunds` and `studyPayments` come only from their own studies (`builder_id = ?`).
  - `studyPayments` rows are `{studyId, amountUnits, feeUnits, status, authorizedAt, settledAt}`, with **no tester id, participation id or wallet**.
  - Reputation: own events, badges, the leaderboard alias, and the fraud findings and withheld-points flags on own work, **without the deciding admin**.
  - Tests: `export-wallet.test.ts` (5) and my PROBE-6.
- **String units:** the new sections use `TokenUnitsString` (`^(0|[1-9]\d*)$`) with the asset, 6 decimals and `settlement: 'simulated'`. The exception is the pre-existing `participations[].payout` (P3-1).
- **No secrets or provider-private fields:** the new rows are `z.strictObject`, with no attempt keys or idempotency keys. `signature` is the simulated transfer id, which is public by nature on a chain.
- **No new cloud or deletion behaviour:** export is a read path. Deletion is unchanged from r2.
- **A builder never exports another tester's wallet or email:** confirmed by the test and by PROBE-6, including the findings and ledger sections.
- **Documentation:**
  - ADR 0007 §8: "Reputation is reversible; settled money is not", "No clawback … no clawback controls over user wallets", and the frozen wallet disclosed;
  - ADR 0007 §9: the export.
- **The app parses the export:** the Settings download in the browser spec, and `ExportBundle.safeParse` succeeds on both exports in PROBE-6.

## Findings (no P0, P1 or P2)

### P3-1: the tester export carries the payout twice, inconsistently
- **Where:** `exportMe` (`apps/api/src/handlers/account.ts`) uses `participationView`, which embeds `payout: payoutView(…)` (`apps/api/src/views.ts:203-220`, `:325-343`).
- In the export, that's `amountUnits` as a **number** plus `attempts` and `failureReason`. `payments.received` carries the same payout as an exact **string**, without those fields.
- It's not a precision problem (≤ 10¹², exact), but it doesn't meet the request for "exact string token units" across the export, and it's redundant.
- **Fix:** in the export, either omit `payout` from `participations[]` (pointing to `payments.received`), or map it to the string-unit shape. Add a test that every `amountUnits` in the export bundle is a string.

### P3-2: the claim about the builder export's participation ids is broader than its test
- **Where:** the `export-wallet.test.ts` builder case (`:76`) asserts no participation id, but its setup has no findings.
- A builder's own `findings` (pre-existing) carry the tester's `participationId` (PROBE-6).
- That isn't a wallet, email or user id, and the builder already sees those participations in the app. So it meets the parent's rule.
- **Fix:** scope the wording or test to "no tester wallet, email or user id", or remove `participationId` from builder-authored findings in the export if participation ids are meant to be excluded too.

## Verdict
The export adds the payment and reputation data with least-data, own-data-only scoping. There are no tester wallets, emails or user ids in builder exports, the new sections use string units, and the rows are strict with no provider-private fields. The redaction is complete, with pass counts unchanged, and the fraud and frozen-wallet consequences are documented.

There are only two P3 consistency notes.

VERDICT: APPROVE
