# Squads devnet pilot, run 1: supplemental readback (lead, `pocketqa-lead`, 2026-10-05)

This file is a **lead-attributed supplement**. It never rewrites the raw run 1 receipt, and the receipt's outcome stays as recorded: **failed**.

**Raw receipt:** `devnet-pilot-receipt-run1.{md,json}`, written by the runner's `afterAll` at code `dc76870`.
- The files were briefly annotated by the lead, then restored by removing exactly the lines and keys the lead added.
  - Markdown: identical by construction.
  - JSON: re-serialised from the parsed original with the writer's own formatting (2-space indent, UTF-8).
- Byte identity with the writer's output can't be proven, because the original bytes weren't hashed before the annotation.
- Restored sha256:
  - `.json`: `5fa8fa93b066572ba82c3134097374f34335bae453186a59c3dd005d8df84422`
  - `.md`: `373a8ca53f5415de6d7cef2c3d614aec4db3a580cdd2f9c803bd5b0c1651e4c2`
- These hashes are pinned in `scripts/check-secrets.mjs`. The receipts list 26 base58 transaction signatures, which have the secret-key shape; only that rule is skipped, and only for these exact bytes.

## What run 1 shows (from the raw receipt)
- **Landed and finalized:** 26 transactions. The runner's `afterAll` read every one back as finalized with no error.
- **Checks that passed:** R0, R1 (×3), R2 (×2), R3 (×3), P1-1 (×2), R4, R5, R6 (×3), R7, R8, C8 (×2) and C2 (×3).

## Where it stopped: a harness error, not a pilot failure
**Expected on-chain refusal: it passed.** Pocket QA created index 4 (1 unit, operation id from `pilot-threshold-refusal-check`), proposed it and approved it alone. The execute was then sent with preflight skipped. The program refused it.

Read back from devnet after the run (`getSignaturesForAddress` on Pocket QA, finalized):
```
4KNLFE1egjonQb85xPGkhoEVyoScz3WyhqQi76Hg4czDLA6S7Ji5Ypk7nyzvnkTKiE3KeAB5x6T7xhNG73kseBiG slot 507704742 err {'InstructionError': [0, {'Custom': 6008}]} # public transaction signature, check-secrets: allow
```
Custom 6008 is Squads `InvalidProposalStatus`, decoded with `@sqds/multisig` `errorFromCode(6008)`. The proposal was still Active, with 1 of 2 approvals. Index 4 stays Active by design.

**Harness error: the run stopped here.**
- The public RPC was rate-limiting (HTTP 429, including on the websocket).
- web3.js 1.99 `confirmTransaction` then fell back to polling, which **rejects** with the raw error object (`index.cjs.js`: `if (value?.err) reject(value.err)`) instead of returning it.
- The runner's `send()` expected a returned value, so it threw before recording the step.
- This also left `receipt.failure` empty.

**Not reached in run 1:**
- the double-execute refusal;
- the program-data readback after the run;
- the final balances and costs.

These are completed by read-only readback and one targeted refusal against run 1's **existing** accounts, after pqa-qa re-reviews the error and runner delta. The full lifecycle is not re-run.

## Read-only readback after run 1 (lead, `apps/api/scripts/squads-pilot-readback.ts`; no key loaded, nothing signed)
```
$ cd apps/api && npx tsx scripts/squads-pilot-readback.ts ../../docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.json <the threshold-refusal signature>
```
The full output is `devnet-pilot-run1-readback.json`.

**Program after the run (R0): unchanged from before.**
- last deploy slot 446638068;
- upgrade authority `HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`;
- account sha256 `5c866bde37d21edfcc92b630aa593a438f0d824be9d176e5904684996a4c0d37`;
- trimmed program bytes sha256 `57a8d2d7ef5409df250415135f29f83da876e5adf5a2e5b5752e323cfb4f2f74`.

**Multisig `AHj8EXYG…5KNE` (R1), as read:**
- threshold 2, time lock 0, config authority `1111…1111` (autonomous), rent collector **null**;
- members: arbiter mask 2, builder mask 2, Pocket QA mask 7.

**Proposals:**
| Index | Status | Approvals |
|---|---|---|
| 1 | Executed | builder and Pocket QA |
| 2 | Executed | arbiter and Pocket QA (the overturned dispute) |
| 3 | Executed | builder and Pocket QA (the refund) |
| 4 | **Active** | Pocket QA only: the threshold-refusal check, which the program refused to execute |

**Transactions:**
- all 26 receipt signatures: finalized, no error;
- the extra threshold-refusal signature: finalized, error `Custom 6008`.

**Balances (base units; SOL in lamports):**
| Account | Balance | Accounting |
|---|---|---|
| Vault USDC | 210,000 | fees 200,000 plus the unmatched deposit 10,000 (C8, R7) |
| Builder USDC | 17,790,000 | 20,000,000 − 3,300,000 funding − 10,000 deposit + 1,100,000 refund (R5) |
| Tester A and tester B USDC | 1,000,000 each | R3, R4, R6 |
| Vault wSOL account | 4,788,440 lamports | the wrong-mint transfer of 3,300,000 plus the account's rent; never credited (R8) |
| Builder | 0 lamports | Pocket QA paid every fee |

**Costs (devnet SOL, no value; failed transaction included):**
- Pocket QA went from 5,000,000,000 to 4,960,000,240 lamports: **39,999,760 spent**.
- Of that, the 27 transactions cost 170,000 in fees.
- The remaining 39,829,760 is rent for the new accounts plus the 10,000,000 lamports wrapped for the wrong-mint check:
  - 3,300,000 of the wrapped amount moved into the vault-owned wSOL account;
  - the rest stays in the builder's wSOL account.
- The test platform fee stays in the vault, per the existing scope.

**Still to do: the double-execute refusal.** A single targeted send executes the already-executed index 1 again on run 1's existing multisig (`test-live/squads-devnet.pilot-run1-complete.live.test.ts`). It runs only after pqa-qa re-reviews this delta.

## pqa-qa live r1 P3s (lead; read-only `getMultipleAccounts`, finalized, after the readback)
**Rent model.** Rent can't be reclaimed: with no rent collector, Squads refuses to close finished transactions.

Measured account rent (lamports):
| Account | Rent |
|---|---|
| Multisig (231 bytes, once per study) | 1,823,720 |
| Token account (165 bytes; vault USDC, each new payee, the wSOL accounts) | 1,488,440 each |
| Vault transaction (398 bytes) | 2,672,080 per payment |
| Proposal (358 bytes) | 2,468,880 per payment |

**Per payout or refund:** 5,140,960 lamports of permanent rent, plus fees.
- The fees, from the receipt fees at index 1: create 5,000, proposal 5,000, Pocket QA's approval 5,000 (the payer is the member), the cosigner's approval 10,000 (payer plus member), execute 5,000. That makes **30,000 per payment**.
- A payee without a token account adds 1,488,440 (paid by Pocket QA).

**Per study:** 1,823,720 for the multisig plus 1,488,440 for the vault token account.

**Run 1 reconciles exactly:**
- 1,823,720 (multisig)
- \+ 5 × 1,488,440 (vault USDC, tester A, tester B, vault wSOL, builder wSOL)
- \+ 4 × 5,140,960 (indexes 1–4)
- \+ 10,000,000 (wrapped for the wrong-mint check)
- = **39,829,760**, equal to the readback's rent-plus-wrapped figure (39,999,760 spent − 170,000 fees).

**Index 4, left on purpose.** It is an Active proposal: 1 unit to tester A, carrying operation id `pqa-op1:` + sha256(`payout|<study>|pilot-threshold-refusal-check`), approved by Pocket QA only.
- It can never execute without a second approval from the builder or arbiter test key, and the adapter never approves it, because no settlement carries its operation id.
- Rejecting it would take two more signed sends (Squads' rejection cutoff with 3 voters and threshold 2). It is documented instead.
- No rent collector is set, so it can't be closed.

**Stranded test fixtures** (valueless devnet; not reclaimed by design or scope):
- Vault USDC 210,000 units: the test fee of 200,000 (no fee transfer, existing scope) and the unmatched deposit of 10,000, which was alerted and never credited. The pilot implements no operator return.
- Vault-owned wSOL: 3,300,000 lamports plus account rent, from the R8 wrong-mint check; never credited.
- The builder's wSOL account: 6,700,000 lamports plus rent; the builder test key could unwrap it.
- Index 4: as above.
