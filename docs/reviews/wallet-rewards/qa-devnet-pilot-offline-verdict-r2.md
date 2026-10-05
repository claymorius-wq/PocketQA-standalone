# pqa-qa: Squads devnet pilot, OFFLINE review verdict, r2

**Candidate:** `dc76870e4b0ad306cc4726dc55a2f06d6221818b` (`feat/wallet-rewards`; the lead's tree was clean). I reviewed `git diff 3023657..dc76870`: 31 files, 1 commit. The yardstick is my offline r1 **including the parent's amendment** (`qa-devnet-pilot-offline-verdict-r1.md`).

**Two separate gates:**
| Gate | Status |
|---|---|
| **OFFLINE review** (code, signing boundaries, the instruction allowlist, retry and recovery safety, failure copy, tests) | **APPROVE**, details below |
| **LIVE receipt gate** (devnet receipts for funding → threshold approval → payout → dispute → refund, plus R0–R8 of `qa-devnet-pilot-test-matrix-r1.md`) | **NOT PASSED.** No receipts exist. The only receipt file is the earlier blocked dry run at `5d5d431` ("Nothing was sent"). **The devnet pilot as a whole is not approved.** This offline approval only lifts the parent's hold on running the live pilot; it doesn't replace the receipts |

**Reviewer setup:**
- I ran everything in my own detached worktree `.worktrees/qa-wr-run` at `dc76870`, installed with `pnpm install --frozen-lockfile --offline`.
- No keys, funds, devnet sends or cloud calls. No subagents, no advisor.
- Scratch probes and Playwright artefacts were deleted afterwards. The tree is clean.
- I read the Squads v4 program source directly to check the lead's on-chain claims.

## What I ran (Node v24.21.0)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets`: 836 files, no findings. Scripts 58; contracts 17; domain 216; API **558** passed plus 2 skipped; mobile 1075 |
| **Playwright, full** | **15/15**, PW_EXIT=0 (**P2-1 fixed**). The screenshots were restored |
| **PROBE-7 r2:** a payout executes, `squads_attempts` is deleted, then a retry | Wallet ATA **1,000,000** (no second transfer). The retry returns the **same** execute signature |
| **PROBE-8:** two **legitimate identical payouts** (same wallet, same 1,000,000 amount, distinct participations, so distinct operation ids), with the mapping deleted between them | Wallet **2,000,000** (each settled once), at **distinct indices** (`payA` at 1, `payB` at 2), with distinct signatures. Neither was adopted as the other |
| **PROBE-9:** a crash right after `createVaultTransfer` landed, then the mapping is lost, then a retry | The existing carrier is **adopted**: the chain transaction index stays **1**, and the wallet gets **1,000,000** (funds moved once) |
| **PROBE-10:** two settlements of one study | They never share an index |
| **Squads v4 source** (`programs/squads_multisig_program/src/instructions/`) | `transaction_accounts_close.rs`: `constraint = multisig.rent_collector.is_some() @ MultisigError::RentReclamationDisabled`, so **with no rent collector, vault transactions can never be closed**, and the operation records stay on chain. `vault_transaction_create.rs`: `args.memo` is **never stored**, which is why the id travels in a Memo instruction inside the message. The creator needs `Permission::Initiate`. `transaction_index = multisig.transaction_index + 1` (strictly sequential) |

## r1 findings, against the amended requirements
| r1 | Change | Status |
|---|---|---|
| **P1-1** (1): a durable on-chain operation id bound to the immutable payload | Every vault message is exactly `[TransferChecked(plan), Memo(pqa-op1:sha256(kind\|studyId\|participationId))]`. Memo is `MemoSq4gq…`, checked as **executable under the immutable BPF loader 2** before signing (`memoProgramExecutable`). The multisig has `rentCollector = null`, so it's permanent (source confirmed). The id is derived from the payment's identity, not from a local row id | **fixed** |
| **P1-1** (2): an authenticated expected proposal | `claimIndex` recovers from chain alone through `findByOperation`, and adopts **only** a single carrier whose decoded payload equals the plan (`sameTransfer` now compares `creator === Pocket QA` and `operation` too) and that isn't claimed by another settlement. Decoding (`rpcChain.getVaultTransfer`) is strict: Squads-owned account, exactly 2 instructions, a pinned Memo with **no accounts** and **strict UTF-8**, no lookup tables, and the exact TransferChecked shape | **fixed** |
| **P1-1** (3): fail closed on ambiguity | More than one carrier, a carrier with a differing payload or creator, or a carrier owned by another settlement is refused with an operator message, and is never created, approved or executed. Non-vault accounts at an index decode as a non-match | **fixed** |
| **P1-1** (4): tests | The lead's tests (identical same-wallet payouts with distinct ids; lost mapping after create, approve:pocketqa, approve:builder, execute and completion; ambiguity, mismatch and ownership refusals; API-level restore through the worker) are green. **My probes 7–10 confirm them independently** | **fixed** |
| **P2-1:** the Playwright regression | Spec updated; **15/15** in my run; evidence refreshed | **fixed** |
| **P3-1:** head-of-line blocking | A claim is released (`DELETE … WHERE execute_signature IS NULL`) on pre-creation stops (wrong next index, insufficient vault). This happens only where no vault transaction exists at the index | **fixed** |
| **P3-2:** an off-curve funder | `getTransfer` reports an off-curve source as none, so funding verification fails (no refundable wallet). A refund can never target a PDA | **fixed** |
| **P3-3:** symlinked key directory | `realpath` on both sides; symlink test, red then green | **fixed** |
| **P3-4** (promoted): copy grounded in receipts | `SettlementFailure.chainState` is filled by `describe()` from a **fresh devnet read** for the operation id: "not created", "created, no proposal yet", "awaiting approvals (n of 2)", "approved, not executed", "executed (signature …, confirming)", "ambiguous", "unknown (the read failed)". A non-devnet RPC gives "not read". The worker writes the read state into the failure reason; only the simulation keeps "Nothing was sent". The app shows "Payment stopped · devnet pilot … Pocket QA re-reads its devnet state and retries", and never "no funds moved" | **fixed** |

## Residual notes (P3, non-blocking)
1. **The old receipt isn't marked superseded.** `docs/reviews/wallet-rewards/devnet-pilot-receipt.md` and `.json` honestly record the blocked dry run at `5d5d431` ("Outcome: failed (BLOCKED …). Nothing was sent"). But contrary to the handoff note, **no file marks them superseded** (a search finds no "supersed" near "receipt"). Add a one-line header saying "pre-fix dry run at 5d5d431; superseded by the next live run".
2. **The recovery scan is O(n) RPC reads per fresh claim** (`findByOperation` walks indices 1 to `transactionIndex`). That's fine for the pilot's tiny studies. Cache or bound it before larger use.
3. **Residual trust, unchanged and disclosed:** two colluding members could reconfigure (for example set a rent collector, close records, then revert). `assertConfig` refuses any non-null rent collector at every submit, but couldn't detect a close-then-revert done between runs. This is inherent to 2-of-3, and in the pilot every key is a test key.

## Verdict
**OFFLINE: APPROVE** for exactly `dc76870`:
- the P1 duplicate-execution defect is fixed with a durable on-chain operation id, authenticated adoption and fail-closed ambiguity handling, verified by my own probes and by the Squads source;
- the P2 regression is fixed;
- every feasible P3 is fixed, and the failure copy is grounded in fresh chain reads.

**LIVE receipt gate: NOT PASSED.** The pilot may now run on devnet (bounded scope, test keys and assets only). I'll then read the receipts independently (R0–R8, `qa-devnet-pilot-test-matrix-r1.md`) before any pilot approval.

VERDICT: APPROVE
