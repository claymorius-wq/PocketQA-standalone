# pqa-qa verdict: wallet-rewards local slice, r1

**Candidate:** `e38c9ab3d70cac05213e25579e39ccc97f9eaa0e` (`feat/wallet-rewards`), reviewed as `git diff 87e09d4..e38c9ab`: 102 files, 9 commits.

**Scope:** ADR 0007, a local **simulated** settlement only.
- No provider, devnet, keys or assets.
- Live devnet evidence is a later **release gate**, not part of this verdict (matrix §J).

**Reviewer setup:**
- I ran everything in my own detached worktree `.worktrees/qa-wr-run` at `e38c9ab`, installed with `pnpm install --frozen-lockfile --offline`.
- The lead's worktree was not touched. No cloud or devnet calls, no subagents, no advisor.
- A temporary probe test file existed only in my run worktree and was deleted afterwards. Its tree is clean.

**The yardstick:** `qa-local-slice-test-matrix-r1.md`, rows A–I.

## What I ran (Node v24.21.0, at `e38c9ab`)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets`: 804 files, no findings. Scripts 57; contracts 17; domain **215**; API **470** passed plus 2 skipped; mobile **1069** |
| Playwright (`apps/mobile`, API with `POCKETQA_SETTLEMENT=simulated`) | **15/15**, including `wallet-rewards.spec.ts` "builder funds a wallet escrow study (simulated); tester joins with a frozen wallet; approval settles once; reputation updates" |
| `pnpm test:e2e:firebase` | **4/4** |
| Dependency changes | none (no `package.json` or lockfile diff) |
| Signing or key code scan of `apps/api/src` and `packages/domain/src` (`sendTransaction`, `signTransaction`, `Keypair`, `secretKey`, …) | **0 hits** |
| My own probes (a scratch vitest in the run worktree) | **PROBE-1:** a builder deleting the account with a **funded draft** returned **200**. The vault kept **3,300,000 units**, with **0 refund rows** and the study left `draft` under a deleted owner (**finding P2-1**). **PROBE-2:** 20 parallel consents for 3 slots gave exactly 3 × 200 and the rest 409; the books balanced. **PROBE-3:** a destination or payout address in the approval body was ignored, and the payout settled to the wallet frozen at consent |

## Matrix results
| Row | Result | Evidence |
|---|---|---|
| **A1** production refusal; off by default | ✅ | `config.ts`: `settlement` is `off\|simulated`; production with anything but `off` gives a ConfigError; test A1 |
| **A2** no provider, mint, RPC or network config; mainnet refused | ✅ | Every `POCKETQA_SETTLEMENT_*` key is refused; test A2 (including the mainnet mint) |
| **A3** no keys, signing or sending | ✅ | Static test A3, plus my scan (0 hits). `SettlementProvider` has only `mode: 'simulated'` |
| **A4** labelled simulated | ✅ | API `settlement: 'simulated'`. The app's `money.ts` reads "simulated USDC", "Settled · simulation, no funds moved" and "Payment failed · simulation … Nothing was sent". Tests A4 and `wallet-rewards-ui` |
| **A5** copy check | ✅ | The `wallet-rewards-ui.test.tsx` copy check plus the app-wide linter |
| **A6** existing production refusals untouched | ✅ | Unchanged config paths; verify is green |
| **A7** separate ledger | ✅ | `escrow_ledger` is separate from `ledger`; test A7 shows escrow studies never touch test credits |
| **B1–B5** funding | ✅ | The server fixes the amount (the quote total), the vault and the mint. The client supplies only a signature. `verifyFundingTransfer` checks every field. `escrow_fundings.signature UNIQUE`, `escrow_one_funding` and `escrow_one_confirmed_funding`. Publishing needs confirmed and exact funding. The domain `observeTokenTransfer` reads **only pre/post token balances**, pinned to the mint and `programId === Tokenkeg…` (tests: a Token-2022 look-alike, a CPI credit, a silent no-change transfer, a vault created in the transaction, safe-integer bounds). Reward and slots lock once funding starts |
| **C1–C3** reservation | ✅ | `canReserve` inside the consent transaction. 20-way test C1 and my PROBE-2 both give exactly 3. The payout wallet is frozen at consent with explicit confirmation (`payoutAddress` must equal the linked wallet) and audited |
| **D1–D6** payout | ✅ | `settlements_one_payout`, `escrow_one_authorization` and `escrow_one_settlement` unique indexes. The worker persists the attempt key **before** `submit`; a crash resubmits the same key and gets the same transfer (D2). Only `finalized` settles, inside a transaction that re-checks `submitted`; `processing` and `not_found` wait (D3/D5). A new attempt key only after `SettlementFailure` ("nothing was sent") or a network-reported failure. Faults for a missing token account, a frozen account and an underfunded relayer are covered. Payment only after approval (D6) |
| **E1–E3** substitution | ✅ | The payout uses `participations.payout_address` from consent. Bodies can't redirect it (E1/E2, PROBE-3). Admin dispute resolution only calls `authorizePayout` (E3) |
| **F1–F4** disputes, refunds, withdrawal, timeout | ✅ | A dispute holds only its reward. Close refunds only the remaining vault, once (`settlements_one_refund`, `escrow_one_refund*`), to the verified funding wallet. Closing is refused while work is submitted or disputed, or still disputable. Withdrawing releases the hold. A timeout never pays (F4) |
| **F5** account deletion | ❌ **partial** | Tester deletion and a still-settling payout are fine (test F5). **A builder with a funded draft or an open funding request can delete the account and strand the funds** (P2-1) |
| **G1–G3** admin powers and audit | ✅ | `/admin/payouts` is read-only. No route sets an amount or destination. Every money transition is audited, with "(simulated settlement)". The ADR 0007 trust model lists the authorities, with the provider disabled |
| **H1–H6** reputation | ✅ | Points only from accepted work: `points_one_award`, append-only triggers, reversal with `reverses_id UNIQUE`. Self-dealing (a payout or linked wallet that funded the same builder) is blocked at consent and withheld from points. The leaderboard is opt-in with an alias, a minimum of 3 decided, a 90-day window and a Wilson quality score (not volume). Response rows are `{rank, alias, qualityScore, decided, badges}` only, with no ids, wallets or emails (domain `rankLeaderboard`). Deletion removes the pseudonym. `noCashValue: true` |
| **I1, I2** invariant and integers | ✅ | `escrowInvariant` over all seven buckets, with no negatives and the double-entry sum equal to zero. Seeded random runs (I1). Safe-integer caps (`MAX_ESCROW_UNITS = 1e12`) and an exact integer fee ceiling. App formatting and parsing by string arithmetic (I2) |

## Findings

### P2-1: a builder can delete the account while a study holds escrow funds that haven't been refunded (funds stranded)
- **Where:** `apps/api/src/handlers/account.ts:251-252`. The deletion guard only checks `studies.status IN ('published','paused')`. Escrow drafts are never considered.
- **Scenario (PROBE-1, executed):**
  1. A builder creates an escrow study and funds it; the funding is **confirmed** and the vault holds 3,300,000 units.
  2. The study is still a `draft` (`createEscrowFunding` requires a draft).
  3. `DELETE /me` gives **200**.
  4. Afterwards the vault still holds 3,300,000 units, there are **no refund settlements**, and the study stays `draft` under a deleted owner. Nobody can close it any more: only the owner closes, and admins have no money route by design.
- **The same applies to an open funding request** (`awaiting_payment` or `pending`). A payment that lands after the deletion is confirmed by the worker into a vault that no one can refund.
- **Impact:** this is exactly the "funding-spend accounting / account deletion" class (matrix F5). In the simulation, the books still balance (`ok=true`) but the funds are unrecoverable. With a real provider this would strand real money.
- **Fix:**
  - **Refuse deletion while** any of the builder's escrow studies has a vault balance above zero, or an `escrow_fundings` row in `awaiting_payment` or `pending`. The message should be along the lines of "Close your funded studies (unused funds are refunded to the funding wallet) before deleting your account".
  - **Or, inside deletion,** close those drafts with `authorizeRefund` (so a refund settles to the funding wallet) and expire open funding requests.
  - Add a test for both cases, and record the decision in ADR 0007. This is consistent with the existing "Close your published studies first" rule, so it's no new retention rule.

### P3-1: reputation and escrow data are missing from the account export (documented boundary)
- **Where:** `exportMe` (`apps/api/src/handlers/account.ts`). Points events, the leaderboard alias, fraud flags and payout history are personal data, and they aren't exported.
- **Fix:** add them to the export before any release. The lead documented this as a known boundary.

### P3-2: permanent payout failures retry forever, with no escalation
- **Where:** `settlement/worker.ts:48`, `RETRY_MS` of 5 minutes, unbounded.
- A frozen account, or a tester with no recovery path (the documented "no change path"), keeps the reward `payable` indefinitely.
- **Fix:** cap the backoff, raise an operations alert or flag after N attempts, and document the manual resolution policy in ADR 0007 before a real provider.

### P3-3: the future adapter's network and mint checks are vacuous in `observeTokenTransfer`
- **Where:** `packages/domain/src/tokenTransfer.ts:64-65`. It copies `network` and `mint` from the expectation, so `verifyFundingTransfer`'s network and mint comparisons can't fail for chain data.
- **Safe today:** a wrong mint credits 0 and fails on amount, and the network relies on the adapter's genesis check.
- **Fix:** before a real adapter, make the genesis or network check part of the observed data (pass the RPC's genesis hash in), so the verifier's checks are meaningful. Also require a non-null `source` before confirming (`verifyFunding` would otherwise store a null `funding_wallet`, and the refund would then fail with INTERNAL).

### P3-4: concurrent worker runs rely on provider idempotency
- Overlapping `runSettlement` calls (startup plus interval) can both pick the same `pending` row.
- My trace: both compute the same key from the same snapshot (`${id}:${attempt+1}`), so the simulator returns one transfer.
- **Fix:** keep "idempotent per key" as a hard requirement in the real-provider ADR, or add a run lock.

## Verdict
**The local simulated slice is well built:**
- fail-closed config;
- no keys or signing;
- honest labelling;
- exact integer money;
- an append-only, double-entry ledger with unique-index idempotency;
- a crash-safe worker;
- frozen payout wallets;
- correct dispute and refund accounting;
- privacy-safe, opt-in reputation.

Every matrix row passes except **F5**. **P2-1** (a builder deleting the account with a funded draft or an open funding request strands the escrow funds) must be fixed before approval.

This verdict concerns the local slice only. It says nothing about real payments. B-2 and B-3, the provider choice and release authority, remain the activation gates.

VERDICT: CHANGES_REQUIRED
