# pqa-qa: Squads devnet pilot, review and receipt matrix, r1

**Authorised scope (Hamza, through the parent):** a bounded **devnet** pilot on the **existing** Squads v4 devnet program (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`).

**Allowed:**
- fresh dedicated test keys, kept outside Git;
- free faucet devnet SOL and official devnet test USDC;
- creating test vaults;
- devnet transactions and readback.

**Not allowed:**
- mainnet, real money, paid services or personal wallets;
- public preview or storage changes;
- new program deployments.

The test keyholders simulate every role. **This is not independent custody.**

**My rules:**
- I generate no keys and spend no assets unless the lead coordinates bounded QA fixtures.
- I record no secret material.
- My chain checks are **read-only** public devnet RPC (`getTransaction`, `getAccountInfo`, `getSignatureStatuses`, `getGenesisHash`).
- I review the **exact frozen SHA** and its receipts only. A docs approval isn't enough.

**What the lead must provide with the frozen SHA:**
- the receipt file: for each step, the signature, the slot and the finalized status, with no secrets;
- the public keys of every role and account: builder, Pocket QA release key, arbiter, multisig PDA, vault PDA, the vault's USDC token account, and the tester or funder token accounts;
- the devnet program-data hash recorded at run time;
- the commands used.

## R. Chain receipts I'll read and verify independently (devnet, finalized)
| # | Step | What I check on chain |
|---|---|---|
| R0 | The cluster and program | `getGenesisHash` equals the devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. The Squads program-data `Fy3YMJCv…sh8n` authority and last-deploy slot match the recorded values (devnet is upgradeable by `HM5y4mz3…dtvK`). The **program-data hash** recorded by the pilot matches what I read, or the doc honestly notes a change between run and review |
| R1 | Multisig creation | The multisig account is owned by the Squads program. `config_authority` is the default (**autonomous**). The members are exactly the three published keys with the documented permissions. **Threshold 2.** **No spending limits** (no `SpendingLimit` accounts for this multisig). `time_lock` and `rent_collector` are as documented |
| R2 | Funding | The transaction is finalized with `meta.err` null. **Pre/post token balance deltas:** the vault's token account gains exactly the quoted units for mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` under program `TokenkegQ…`, decimals 6. The funder's account falls by the same amount. The reference key is present. The app's recorded funding equals the chain |
| R3 | Threshold-approved payout | A vault transaction, its proposal **approved by 2 distinct members**, then executed. The execute transaction's balance deltas show the vault falling by exactly the reward and **the frozen tester token account** rising by it. No other token movement. The proposal can't be executed twice (status `Executed`) |
| R4 | Dispute | A rejected work item, then a dispute, then the arbiter co-signs (overturned), then a payout following R3's rules. Or upheld: no transfer. The app's state and audit agree |
| R5 | Refund | After close, a vault transaction to the **funding wallet's** token account only, for exactly the remaining vault units, approved by 2 members. Afterwards the vault token balance is 0, or equals the outstanding payables if any are still pending |
| R6 | Duplicate submission and recovery | Re-submitting the same intent after a simulated crash produces **no second on-chain transfer**. Two different proposal or transaction indices for the same payout must not both execute. The app reconciles to one settlement |
| R7 | Unmatched deposit | A transfer to the vault without a matching funding request is **not credited**. The documented handling is a sweep, a report, or held for a manual refund, never silently added to a study budget |
| R8 | Wrong mint, network or decimals | A transfer of another devnet mint, or the right mint to the wrong account, is refused by the verifier. Signing refuses any non-devnet genesis, any mint other than the pinned one, and any program other than the pinned Squads program |

## C. Code and policy checks on the frozen SHA
| # | Check |
|---|---|
| C1 | **Production hard gate:** production config refuses Squads or devnet settlement. Mainnet RPC, the mainnet mint and a mainnet genesis are refused in every mode. Key paths are never in the repo, and their files are 0600 outside Git |
| C2 | **Pinning at signing time:** before signing, the code checks the genesis hash, the Squads program id, the mint and decimals, and that the destination is the frozen tester token account (or the funding wallet's, for a refund) with the exact reserved amount. Any mismatch refuses **before** a signature |
| C3 | **Arbitrary-transfer policy:** the server only ever proposes `transferChecked` of the pinned mint from the vault, with these limits:<ul><li>to the frozen destination, for the exact amount;</li><li>to the funding wallet, for the remaining vault.</li></ul>No other instruction types, no config transactions (adding members or spending limits) and no batch transactions. Tested with adversarial inputs |
| C4 | **Finality:** credits and settlements only at `finalized`, read from balance deltas (the existing `observeTokenTransfer`). `confirmed` is shown as pending |
| C5 | **Idempotency and recovery:** a persisted attempt key or proposal index before submission. A retry reuses it. Stale or abandoned proposals are cancelled or never executed. Tests for a crash between create, approve and execute |
| C6 | **Secrets:** no private keys, seed phrases or secret-key arrays in the repo, logs or evidence. `check-secrets` is clean. The receipt files contain only public keys and signatures. Keypair files are never read into logs |
| C7 | **Honesty in the UI and docs:**<ul><li>"devnet test USDC, no value";</li><li>"pilot: test keys simulate all roles; not independent custody";</li><li>"two of three signers must approve" (wording);</li><li>no "trustless", no unqualified "paid".</li></ul>The devnet-upgradeability disclosure and the program-data hash are shown in the docs |
| C8 | **Accounting:** the ledger invariant holds against chain state after every step: the vault token balance equals available plus held plus payable not yet settled (plus pending refund). Any difference is an alert. Fees are separated |
| C9 | **Regressions:** `pnpm verify`, Playwright, the Firebase emulator suite, and all the existing local-slice escrow tests (A–I) still pass. The simulated mode is unchanged |
| C10 | **Account deletion and refunds** follow the r2 rules (no stranded funds), now with chain refunds |

## Verdict rule
- A failing R or C row is P0–P2, depending on impact. UI and accounting defects are included.
- **All P0–P2 must be fixed before I approve.**
- Any approval covers the devnet pilot at the exact SHA only. Mainnet stays gated: a verified build match, legal and custody review, and Hamza's separate approval.
