# pqa-qa: Squads devnet pilot, LIVE receipt verdict r1 (run 1, independent read-only read-back)

**Code that ran:** `dc76870e4b0ad306cc4726dc55a2f06d6221818b` (OFFLINE r2 APPROVE). The receipt names commit `18962e3`, which has **no code change** against `dc76870`: `git diff --stat dc76870 18962e3 -- . ':!docs'` is empty.

**Receipts:**
- `docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.{md,json}`, the raw runner receipt. Outcome **failed** (a partial run that stopped on a harness error).
- `devnet-pilot-run1-readback.md`, the lead's attributed supplement.

Both are at branch commit `59f721d`, which is docs and scanner allowance only.

**Roles: test signing only.** Every signer (builder, Pocket QA release key, arbiter, testers) is a **pilot test key held by the implementation**. There are no real devices, no user wallets, and **no independent custody**. The assets are devnet test SOL and Circle devnet test USDC, with **no value**. **No production claim** is made or implied.

**Method:**
- Read-only public devnet RPC only: `getGenesisHash`, `getAccountInfo`, `getTransaction`, `getSignaturesForAddress`, `getTokenAccountBalance`, `getBalance`, and one `getProgramAccounts` with filters.
- Calls were paced, with retries and backoff.
- No keys, no sends.
- Decoding used the pinned `@sqds/multisig 2.1.4` in my own detached checkout at `dc76870`.
- The pre-run baseline is in `qa-devnet-pilot-live-baseline.md` (my reads).

## Independent read-back results
| Matrix row | What I read on devnet | Result |
|---|---|---|
| **R0: cluster and program** | Genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. The Squads program-data `Fy3YMJCv…sh8n` **after the run**: upgrade authority `HM5y4mz3…dtvK`, last deploy slot 446,638,068, length 1,774,845, account sha256 `5c866bde…0d37`, trimmed program-bytes sha256 `57a8d2d7…2f74`. **All identical** to the receipt's "before". This completes the program-after readback the run didn't reach | ✅ the devnet program didn't change during the pilot (still single-key upgradeable, as disclosed) |
| **R1: multisig** | `AHj8EXYG…KNE`: owner Squads, `configAuthority` default (autonomous), threshold **2**, `timeLock` 0, **`rentCollector` null**, `staleTransactionIndex` 0, `transactionIndex` 4. Members are exactly arbiter `5ZFcx5EB…` (2 = Vote), builder `6XoDNcAj…` (2 = Vote) and Pocket QA `DoUXiXfn…` (7 = Initiate+Vote+Execute). **No SpendingLimit accounts:** `getProgramAccounts(Squads, discriminator + multisig@8)` returned **0** | ✅ |
| **R2: funding** | `5dp18gzH…` (slot 507,704,351, finalized, err null): builder ATA `3pnsfDdy` **−3,300,000**, vault ATA `FoCyeMea` **+3,300,000**, mint `4zMMC9…` under the **classic** Token program | ✅ exact, equal to the quote (3 × (1,000,000 + 100,000 fee)) |
| **R3: threshold payouts** | Vault transactions 1 and 2 (decoded): creator Pocket QA, vault index 0, **2 instructions** (TransferChecked, opcode 12, 6 decimals; then Memo `MemoSq4g…` with 0 accounts), no lookup tables. Destinations tester A `3zQEpQEm` and tester B `FTKn1SeY`, 1,000,000 each. Proposals **Executed**, approved by {builder, Pocket QA} and {arbiter, Pocket QA}. Executes `5nquBJWm…` and `4V7HR6de…`: vault −1,000,000, tester +1,000,000 each | ✅ |
| **R4: dispute** | Index 2 was co-signed by the **arbiter** (the overturned dispute); tester B +1,000,000 | ✅ |
| **R5: refund** | Index 3: TransferChecked of **1,100,000** to the **builder's (funding wallet's) ATA**, with memo `pqa-op1:0a5fbb0b…f8da`. **That equals my own `sha256("refund\|188d6b60-…\|-")`.** Executed with {builder, Pocket QA}; execute `5D1cJ9TV…`: vault −1,100,000, builder +1,100,000 | ✅ |
| **R6: unique operation, no double execution** | Indices 1–3 each carry a **distinct** `pqa-op1:` memo. `getSignaturesForAddress` on each transaction PDA shows **exactly one successful execute** for indices 1, 2 and 3, and **0 successful, 1 failed** for index 4 | ✅ no double execution occurred. ⚠️ the deliberate **double-execute refusal** wasn't exercised (the run stopped first). The lost-mapping recovery is covered offline (r2), not on chain in this run |
| **Threshold refusal** | Index 4: a 1-unit test transfer to tester A, memo `pqa-op1:c0ca82c0…`, proposal **Active** with only Pocket QA's approval. Execute `4KNLFE1e…` (slot 507,704,742) is finalized with **`InstructionError [0, Custom 6008]`** (InvalidProposalStatus), and no token deltas | ✅ the refusal holds on chain |
| **R7: unmatched deposit** | `3njTpvNH…`: builder −10,000, vault +10,000, with no reference. The receipt shows the worker alert; the books don't credit it | ✅ (chain delta verified; the alert is as recorded) |
| **R8: wrong mint** | `3jRS6yqC…` wraps 0.01 SOL (+10,000,000 wSOL to a test wSOL account). `4CCcmmDe…` moves **wSOL** 3,300,000 between wSOL accounts, with no USDC movement. The API reports it "failed: a different token" | ✅ not credited |
| **C8: books against chain** | **Final balances:** vault **210,000** = fees 200,000 (illustrative test fee, kept in the test vault) + unmatched 10,000. Builder **17,790,000** = 20,000,000 − 3,300,000 − 10,000 + 1,100,000. Tester A 1,000,000; tester B 1,000,000 | ✅ exactly reconciled |
| **All 27 signatures** (26 in the receipt plus the refusal) | Each read at `finalized`: **slot, fee and fee-payer match the receipt for all 27** (0 mismatches). Every `err` is null except the expected 6008 refusal | ✅ |

## Measured costs (devnet; test SOL, no value)
- **Pocket QA release key:** 5,000,000,000 lamports before (my baseline), 4,960,000,240 after. **Spent 39,999,760 lamports** (about 0.04 test SOL) for the whole run.
- **Network fees:** **170,000 lamports** across 27 transactions (5,000 per signature; 10,000 for two-signer transactions).
- **The rest, 39,829,760 lamports:**
  - **10,000,000** wrapped into the R8 wrong-mint test fixture;
  - account rent: the multisig, the vault ATA, two tester ATAs, the wSOL test accounts, and four vault-transaction plus four proposal accounts.
- **Because `rentCollector` is null (by design, so operation records stay permanent),** vault-transaction and proposal rent is **never reclaimable**. That's a per-payment cost to model before any pricing (P3-1). I didn't itemise rent per account.

## Receipt integrity
- The lead disclosed annotating and then restoring the raw receipt; byte identity with the writer's output is unprovable.
- **This doesn't affect the verdict on the chain facts:** every on-chain claim above comes from my own devnet reads, not from the receipt.

## Not yet passed (blocking the LIVE gate)
1. **The R6 deliberate double-execute refusal** wasn't run on chain, because the run stopped first.
2. **The runner and adapter harness fix** (web3.js `confirmTransaction` rejecting under 429 polling; the lead's coming "outcome unknown" mapping) **must be reviewed before any further send**, as the lead proposes.
3. **The run's own after-state** (program after, balances, costs) was never written by the runner. It's covered here by my independent reads, and should be recorded in the next receipt as well.

## Residual notes (P3)
1. **Non-reclaimable rent per payment** (rent collector null): add the measured per-study and per-payment SOL cost to ADR 0007 and the quote model.
2. **Index 4 stays an Active 1-unit proposal**, approved by Pocket QA only. Any second member (builder or arbiter, both test keys) could execute it, sending 1 base unit to tester A. That's bounded and harmless on devnet, but it should be documented as a deliberate leftover, or rejected or cancelled in the follow-up run.
3. **Stranded test fixtures:** the wSOL test accounts (10,000,000 wrapped lamports) and the 10,000-unit unmatched USDC deposit stay in place. Return them by hand only if the pilot scope allows; no deletion is implied.

## Verdict
**Every step run 1 reached is verified independently on devnet, exactly as the receipt claims:**
- cluster and program unchanged;
- autonomous 2-of-3 with no spending limits and no rent collector;
- funding, two threshold payouts (one arbiter co-signed), the refund to the funder with my independently recomputed operation id, the unmatched-deposit and wrong-mint refusals;
- the on-chain under-threshold refusal;
- exactly one execute per payment;
- the books reconciled to the unit.

**The LIVE gate is not yet passed.** The double-execute refusal wasn't exercised, and the harness delta needs review before any further send.

The pilot is **not** approved yet, and any eventual approval will concern a **devnet pilot with test keys simulating every role**. That's not real devices, not independent custody, and not production.

VERDICT: CHANGES_REQUIRED
