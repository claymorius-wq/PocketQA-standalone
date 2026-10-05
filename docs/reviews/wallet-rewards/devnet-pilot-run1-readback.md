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
