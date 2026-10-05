# pqa-qa: Squads devnet pilot, OFFLINE review verdict, r1

**Candidate:** `3023657574e941d259050f47cbd4f51e0e2cc8ed` (`feat/wallet-rewards`). The lead's worktree was clean at that HEAD. I reviewed `git diff d260874..3023657`: 52 files, 5 commits.

**Two separate gates:**
| Gate | Status |
|---|---|
| **OFFLINE review** (code, signing boundaries, the instruction allowlist, retry safety, tests) | **CHANGES_REQUIRED**, findings below |
| **LIVE receipt gate** (devnet chain receipts for funding → threshold approval → payout → dispute → refund, plus R0–R8 of `qa-devnet-pilot-test-matrix-r1.md`) | **NOT PASSED.** No receipts exist: the faucets are blocked (`faucet-request.md`), and the test keys hold 0 SOL and 0 devnet test USDC. **The devnet pilot is not approved.** |

**Reviewer setup:**
- I ran everything in my own detached worktree `.worktrees/qa-wr-run` at `3023657`, installed with `pnpm install --frozen-lockfile --offline`.
- No keys, funds, devnet sends or cloud calls. No subagents, no advisor.
- Scratch probes and Playwright artefacts existed only in my run worktree and were deleted afterwards. Its tree is clean.

## What I ran (Node v24.21.0)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets`: 836 files, no findings. Scripts 58; contracts 17; domain 216; API **527** passed plus 2 skipped (including `squads-adapter`, `squads-api` and `squads-rpc-chain`); mobile **1075** |
| New dependencies | exact pins: `@solana/spl-token 0.4.15`, `@solana/web3.js 1.99.0`, `@sqds/multisig 2.1.4` (MIT), in `apps/api` only. The lockfile was reviewed for those three |
| **Playwright, full** (`apps/mobile`) | **14 passed, 1 FAILED:** `e2e/wallet-rewards.spec.ts:156`. It expects "wallet escrow records (simulated)" but got "… wallet escrow records (each labelled with its settlement) …" (**P2-1**). The committed `docs/reviews/wallet-rewards/playwright.txt` was last changed at `90506e9`; it wasn't re-run on this candidate |
| **PROBE-7** (my own; the lead's `FakeSquadsChain` plus the real `SquadsDevnetSettlement`) | One payout settles (tester ATA 1,000,000). Then the `squads_attempts` row for that settlement is deleted, as a restore from an older database backup would do, and `submit` is retried with a new attempt key. **A second vault transaction is created and executed: tester ATA 2,000,000** (**P1-1**) |

## What's correct (verified in code and tests)
- **Production hard gate.** `config.ts`:
  - `squads_devnet` is refused when `production`;
  - the only provider setting is `POCKETQA_SETTLEMENT_PILOT_KEYS_DIR`: absolute, outside the repo, mode 0700;
  - every other `POCKETQA_SETTLEMENT_*` is refused;
  - the RPC is hardcoded to `https://api.devnet.solana.com`, with no override.
- **Pins checked before signing.** `adapter.ts` `assertPins` checks, before every signing step:
  - the genesis equals devnet;
  - the Squads program is executable under the upgradeable loader, with program-data `Fy3YMJCv…sh8n`;
  - the mint is owned by the classic Token program, with 6 decimals.
  
  `rpcChain.ts` `send()` also re-checks the genesis **immediately** before each signature. `createMultisig` refuses a non-zero creation fee.
- **Instruction allowlist.** `submit` builds the plan only from the **recorded settlement row**, and refuses any request that differs from it. The destination must be an on-curve wallet that isn't the vault, and the source must be this study's vault ATA.
  - Before any approval, the stored vault transaction is **decoded** (`getVaultTransfer`) and must equal the plan exactly: 1 instruction, the classic Token program, `TransferChecked` (12), no lookup tables, 4 accounts, 10 data bytes, and the exact source, mint, destination ATA, authority (vault 0), amount and decimals. Anything else at that index is **never approved**.
  - The server never builds config transactions, spending limits or batches. Only Pocket QA has Initiate.
- **Multisig config** (`assertConfig`): autonomous (`configAuthority` default), threshold 2, `timeLock` 0, `rentCollector` Pocket QA, exactly three members (builder Vote, Pocket QA Initiate+Vote+Execute, arbiter Vote). It's checked on every submit.
- **Retry within the same database:** one claimed index per settlement, persisted before sending (`squads_attempts`, `UNIQUE(multisig, tx_index)`). Retries re-read the chain and do only the missing steps. `Executed` or `Executing` looks up the execute signature and never executes again. Every send waits for `finalized`.
- **Funding and reconciliation:** funding is observed from finalized balance deltas with the observed network. `reconcileVaultOnChain` alerts on unmatched deposits (never credited or spendable) and on shortfalls.
- **Secrets:** keys are loaded from a 0700 directory with 0600 files and never logged. Receipts contain only signatures, slots and fees. `check-secrets` is clean.
- **Honest UI:** "devnet test USDC, no value"; "Pilot: test keys simulate all roles … not independent custody"; "two of three signers"; "Settled on devnet · test USDC, no value". No "trustless".
- **Upgradeability disclosure:** the live runner records the devnet upgrade authority and the program-data hashes (`squads-devnet.pilot.live.test.ts:207-210`). It's gated by `POCKETQA_LIVE_SQUADS_DEVNET=1`.

## Findings

### P1-1: a payout or refund can execute twice when the local index mapping is lost (for example, a database restore)
- **Where:** `apps/api/src/settlement/squads/adapter.ts:179-197` (`claimIndex`, then `createVaultTransfer`).
  - De-duplication relies **only** on the local `squads_attempts` row.
  - If it's missing, the adapter claims `max(chainIndex, claimed)+1`, creates a **new** vault transaction for the same plan, approves it and executes it.
- **Scenario (PROBE-7, executed):**
  1. The payout executes on chain (tester ATA 1,000,000).
  2. The `squads_attempts` row disappears. A restore from a backup taken before that index was recorded does exactly this, and restore is a documented runbook operation. The settlement row would also be back at `pending` or `submitted`.
  3. The worker retries.
  4. **A second transfer lands (tester ATA 2,000,000).**
- **Impact:** the provider contract's own invariant ("the same `settlementId` never moves funds twice", `types.ts`) is violated on a recovery path. This is the duplicate-payout class this review exists for. It's devnet-only today, but the design carries over to real money.
- **Fix:** before claiming a **fresh** index, scan the study multisig's existing vault transactions (indices 1 to the chain's `transactionIndex`, plus their proposals) for one whose decoded transfer equals the plan.
  - If found, **adopt that index**: record it in `squads_attempts`, and if it's already `Executed`, return its execute signature. Never create a duplicate.
  - The plan is unique per settlement: one payout per participation (one tester per study) and one refund per study.
  - Also make the worker run this reconciliation, or refuse to start settling, after `db:restore`.
  - **Tests:** delete the mapping after execution, then retry; there must be no second transfer. Do the same after creation-only and after approval-only.

### P2-1: the browser test is broken by the pilot copy change, and its evidence is stale
- **Where:**
  - `apps/mobile/src/screens/SettingsScreen.tsx` changed the export summary to "wallet escrow records (each labelled with its settlement)";
  - `apps/mobile/e2e/wallet-rewards.spec.ts:156` still expects "wallet escrow records (simulated)".
- **Result:** `npx playwright test` gives 14 passed, **1 failed**, deterministically.
- **Evidence:** the committed `docs/reviews/wallet-rewards/playwright.txt` comes from `90506e9`.
- **Fix:** update the spec, or keep a settlement-specific summary, then re-run and commit Playwright evidence for the candidate.

### P3-1: head-of-line blocking on a claimed index that never gets created
- **Where:** `adapter.ts:187-193`.
- If a settlement claims index *n* and then fails before creating it (for example "vault holds less than this transfer"), every later settlement of that study waits on *n*.
- **Fix:** document an operator path, or release an uncreated claim on a definitive pre-creation failure.

### P3-2: a refund to an off-curve funding wallet never settles
- **Where:** `isWallet`.
- A funding from a PDA-owned token account would make the refund refuse forever (it escalates after 5 attempts).
- **Fix:** refuse such fundings at verification instead (no on-curve source, no confirmation), with a test.

### P3-3: the key-directory outside-repo check doesn't resolve symlinks
- **Where:** `config.ts` (`relative(REPO_ROOT, dir)`).
- **Fix:** `realpathSync` both paths.

### P3-4: "Nothing was sent" wording after partial on-chain steps
- **Where:** the worker audit and failure copy.
- After a `SettlementFailure` raised once the vault transaction or approvals have already landed, funds still haven't moved, but transactions were sent.
- **Fix:** say "no funds moved".

## Amendment (2026-10-05, parent correction; supersedes the P1-1 "Fix" and the P3-4 wording above)

### P1-1, corrected fix requirement
Matching on transfer equality (source, destination, amount) is **not** a valid identity. It can conflate legitimate identical payments. Although today's schema allows one payout per participation, two different participations can pay the same wallet the same amount, for example one tester across studies sharing a vault model, or future multi-slot rules. The fix must instead provide:
1. **A durable on-chain operation identity.** Each settlement gets a unique operation id (for example derived from the settlement id) that is **bound into the immutable on-chain payload** of the vault transaction and recoverable from the chain alone, with no local state needed.
   - For example, an SPL Memo instruction carrying the operation id inside the same vault transaction message.
   - Or a deterministic, settlement-derived ephemeral or PDA account included in the instruction accounts.
   - The allowlist must then accept exactly `[TransferChecked(plan), Memo(opId)]`, or the equivalent, and nothing else.
2. **An authenticated expected proposal.** Recovery adopts an existing index **only if** its decoded payload equals the plan **and** carries this settlement's operation id. It must also have been created by the Pocket QA initiator key, so a proposal someone else injected can't be adopted.
3. **Fail-closed ambiguity handling.** If more than one on-chain transaction carries the same operation id, or one carries it but its payload differs from the plan, **refuse and alert**. Never create, approve or execute in that state; an operator resolves it.
4. **Tests:**
   - **two legitimate payouts with equal amounts to the same wallet, with distinct operation ids:** both settle exactly once each, and neither is adopted as the other;
   - **for the same operation id, with the local mapping lost after (a) creation, (b) approval, (c) execution:** recovery adopts the existing transaction, and funds move exactly once (or not again, after execution);
   - the ambiguity cases (a duplicate op id, or an op id whose payload differs) are refused and alerted.

### P3-4 is promoted: failure copy must be grounded in receipts
- A partial run may already have **moved test assets**: the execute may have landed even if the local record says otherwise.
- So neither "Nothing was sent" nor a generic "no funds moved" is safe.
- **Required:** failure and status copy must reflect the observed chain state for that operation id:
  - "not created";
  - "created, awaiting approvals";
  - "approved, not executed";
  - "executed (signature …), confirming";
  - "state unknown, checking the chain".
- **Never** assert that no funds moved without a chain read that proves it.

**Live runs:** the lead is instructed to hold **all** live devnet runs until a revised OFFLINE approval, even if the keys get funded.

## Verdict
**OFFLINE:** the signing boundary, the pins, the transfer-only allowlist, the multisig config checks, the fail-closed production gate, the secrets handling and the honest labelling are all solid.

One **P1** blocks: a double execution when the local index mapping is lost, reproduced. One **P2** blocks: a deterministic Playwright regression with stale evidence. Both must be fixed and re-frozen.

**LIVE:** not passed. No devnet receipts exist yet, and the pilot is **not** approved without them.

VERDICT: CHANGES_REQUIRED
