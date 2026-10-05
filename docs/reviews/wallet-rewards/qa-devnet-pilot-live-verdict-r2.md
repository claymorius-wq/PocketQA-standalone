# pqa-qa: Squads devnet pilot, LIVE receipt verdict r2 (run 1 plus its completion, independent read-only readback)

## Code and receipts covered
| Part | Code | Receipts |
|---|---|---|
| **Run 1** (funding, threshold payouts, dispute, refund, R7/R8 refusals, under-threshold refusal) | `dc76870e4b0ad306cc4726dc55a2f06d6221818b` (OFFLINE r2 APPROVE). The receipt names `18962e3`, which has no code diff | `devnet-pilot-receipt-run1.{md,json}` and `devnet-pilot-run1-readback.{md,json}`. Verified in my `qa-devnet-pilot-live-verdict-r1.md` |
| **Completion** (R6 double-execute refusal) | `0b66267ac631671008d8cc66736cab6d79e80646`, clean tree (harness delta r2 APPROVE) | `devnet-pilot-run1-completion.{md,json}`, committed at `8f0246fa4d89cdf91db368aa7f8192f7a06f16d2` |

On `8f0246f`, the only change on top of `0b66267` is docs, plus two scanner hash pins. I re-hashed both pinned files and they match: `.json` `2bde5240…d14a` and `.md` `147f7cca…1998`. The only long base58 string in either file is the transaction signature.

**Roles: test signing only.** Every signer (builder, Pocket QA release key, arbiter, testers) is a **pilot test key held by the implementation**. There are no real devices, no user wallets, and no independent custody. The assets are devnet test SOL and Circle devnet test USDC, with no value. **No production or mainnet claim** is made or implied.

## Method
- Read-only public devnet RPC, paced at 1.5 s with backoff.
- No keys, no sends.
- I used a scratch script outside the repo, which I deleted afterwards, decoding with the pinned `@sqds/multisig`.

## Completion readback (signature `3zNWsdDxaSwMxx9Y3HnNJPp4uPuMstJcNvMQy6R86MUWM6RSamJVyYrF3B82rcFyYUp2B7PJuyYT7uhRW3G8gPES`)
| Check | What I read on devnet | Result |
|---|---|---|
| **Cluster** | Genesis `EtWTRABZ…ZBG` | ✅ devnet |
| **Status** | `finalized`, slot **507,709,054**, err **`{"InstructionError":[0,{"Custom":6008}]}`** | ✅ matches the receipt |
| **Transaction** | 1 signer, fee payer Pocket QA `DoUXiXfn…`, fee **5,000**. Exactly **1 instruction**: Squads `SQDS4ep6…` `VaultTransactionExecute`. Accounts: multisig `AHj8EXYG…`, proposal 1 PDA `Eytn247B…`, transaction 1 PDA `CCzvDHAK…`, member Pocket QA, vault `BoYeczYj…`, vault ATA `FoCyeMea…`, tester A ATA `3zQEpQEm…`, Token, mint, Memo | ✅ a second execute of index 1, nothing else |
| **Program logs** | `AnchorError thrown in …/vault_transaction_execute.rs:75. Error Code: InvalidProposalStatus. Error Number: 6008`; 18,638 compute units; no inner transfer invoked | ✅ refused by the proposal-status check, **not** by a token failure |
| **Deltas** | Token pre equals post: vault **210,000**, tester A **1,000,000**. The only lamport delta is Pocket QA −5,000 (the fee) | ✅ nothing moved |
| **Index 1 history** (`getSignaturesForAddress` on the transaction 1 PDA) | Create `xrxNCqfE…` (slot 507,704,392) and execute `5nquBJWm…` (507,704,452, success), then the refused `3zNWsdDx…` | ✅ **exactly one** successful execute ever |
| **Proposal 1 after** | `Executed`, approved by {builder `6XoDNcAj…`, Pocket QA} | ✅ |
| **Multisig after** | Threshold 2, timeLock 0, configAuthority default (autonomous), rentCollector null, transactionIndex 4, members arbiter 2 / builder 2 / Pocket QA 7 | ✅ unchanged |
| **Program-data after** | Last deploy slot 446,638,068, upgrade authority `HM5y4mz3…dtvK`, account sha256 `5c866bde…0d37` | ✅ identical to before run 1 |
| **Balances now** | Tester A ATA 1,000,000; vault ATA 210,000 | ✅ receipt pre equals post |
| **Total cost** | Pocket QA 5,000,000,000 (my baseline) → **4,959,995,240**, so **40,004,760 lamports** (run 1 39,999,760 + 5,000) | ✅ equals the lead's figure |

## Matrix status (`qa-devnet-pilot-test-matrix-r1.md`)
| Row | Status | Evidence |
|---|---|---|
| R0 cluster and program pins | ✅ | live r1 plus this readback |
| R1 multisig config | ✅ | live r1 plus this readback |
| R2 funding | ✅ | live r1 |
| R3 threshold payouts | ✅ | live r1 |
| R4 dispute (arbiter co-sign) | ✅ | live r1 |
| R5 refund to the funder | ✅ | live r1 |
| Under-threshold refusal | ✅ | live r1 |
| **R6 no double execution** | ✅ | **on chain, this completion** |
| R7 unmatched deposit | ✅ | live r1 |
| R8 wrong mint | ✅ | live r1 |
| C8 books reconciled | ✅ | live r1 |

**The live r1 blockers are cleared:**
1. **R6:** exercised on chain.
2. **Harness delta:** reviewed (r1 CHANGES_REQUIRED, then r2 APPROVE).
3. **After-state:** recorded by the completion receipt and by this readback.

**The live r1 P3s are documented** in `devnet-pilot-run1-readback.md` at `0038b9d`: per-payment rent, index 4 left Active, stranded fixtures. I verified the rent arithmetic.

## Scope limits (stated, not defects)
- **R6 shows the Squads program's own refusal.** The adapter's double-payout protection under a lost local mapping (an operation id in the memo, authenticated adoption, fail-closed) is evidenced **offline** (OFFLINE r2, probes 7–10). It was not exercised live.
- **The pilot ran as one partial run plus a targeted completion send**, not one uninterrupted lifecycle.
- **Devnet Squads is single-key upgradeable** (authority `HM5y4mz3…`), and the mainnet build is not source-verified. Disclosed; unchanged during the pilot.

## Verdict
**LIVE receipt gate: PASSED** for the **Squads v4 devnet pilot**:
- code `dc76870` (run 1) and `0b66267` (completion send);
- receipts `devnet-pilot-receipt-run1.{md,json}`, `devnet-pilot-run1-readback.{md,json}` and `devnet-pilot-run1-completion.{md,json}` at `8f0246f`;
- every on-chain claim independently read back by me.

**What this approval is not:** it covers **test keys simulating every role**. It is not real devices, user-held wallets or independent custody. It is not mainnet, not real funds, and **not a production readiness claim**.

VERDICT: APPROVE
