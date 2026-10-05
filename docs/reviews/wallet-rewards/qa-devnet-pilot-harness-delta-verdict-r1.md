# pqa-qa: Squads devnet pilot, harness delta verdict r1 (before any further send)

**Candidate:** `d1b8cf726ea57618e6adb74e38e6af9799aa2032`. Code against my OFFLINE-approved `dc76870` (`git diff dc76870..d1b8cf7 -- apps scripts packages`) is 7 files: `rpcChain.ts` send(), `squads-rpc-chain.test.ts`, the run-1 runner, `scripts/squads-pilot-readback.ts`, `check-secrets.mjs` + test, and the new `squads-devnet.pilot-run1-complete.live.test.ts`. `0038b9d` on top is docs only (`devnet-pilot-run1-readback.md`, +35); it touches no pinned file.

**Setup:**
- I worked in detached `.worktrees/qa-wr-run` at `d1b8cf7`, on Node v24.21.0.
- Read-only: no keys, no sends, no RPC calls in this review.
- No subagents, no advisor.

## Gates I ran
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. check:secrets 844 files, no findings. Scripts 59/59; contracts 17; domain 216; API 560 + 2 skipped; mobile 1075 |
| Pinned evidence hashes (`shasum -a 256`) | `devnet-pilot-receipt-run1.json` `5fa8fa93…4422`, `.md` `373a8ca5…e4c2`, `devnet-pilot-run1-readback.json` `5702cddd…22e5`. **All equal** to `PINNED_EVIDENCE` |

## Review
| Item | Finding | Status |
|---|---|---|
| **`RpcSquadsChain.send` confirm mapping** | **Non-Error rejection** (web3.js `reject(value.err)`): it re-reads the status with history. The step is reported as "failed on devnet (finalized)" **only** when the chain says finalized with an err. Every other case is "outcome unknown". **Error rejection** (expiry, socket): rethrown. Both are plain `Error`s, so the worker rethrows them (`worker.ts:66`). The settlement is not marked failed, and the next tick recovers from chain via `claimIndex`. That is fail-closed and unchanged from dc76870. The tests cover finalized, confirmed, no-status and Error expiry | OK |
| **Runner** (`pilot.live.test.ts`) | Same rule: a landed failure is recorded only at finalized; otherwise "outcome unknown", with no retry. Non-Error failures are captured via `JSON.stringify` | OK |
| **Readback script** | Loads no key and signs nothing. Genesis is asserted, and every read is paced at 400 ms | OK |
| **`PINNED_EVIDENCE`** | It skips **only** `base58-secret-key`, **only** for the exact path plus sha256. All other rules still run. A one-byte edit or another path restores the rule (tested). Before pinning, I confirmed that these files list transaction signatures, which I read back on devnet myself in live r1 | OK |
| **Completion test, pre-checks** | Asserts: genesis; program-data equal to the readback; multisig 2-of-3, timeLock 0, autonomous, rentCollector null; proposal 1 Executed; balances tester A 1,000,000 and vault 210,000. It sends **one** transaction with no resend loop, and `maxRetries` rebroadcasts the same signature. Bounded: even if the program accepted the execute, the vault holds less than the 1,000,000 transfer | OK |

## Findings
**P2-1: any error is accepted as the expected refusal**
- Where: `apps/api/test-live/squads-devnet.pilot-run1-complete.live.test.ts:116,121`.
- Problem: `out.outcome = st.err ? 'refused-as-expected' : …` treats **any** error as the R6 refusal. The vault holds only 210,000 while index 1 transfers 1,000,000. So if Squads did **not** enforce the proposal status, the execute would still fail on the token transfer (an SPL insufficient-funds error inside the CPI). That failure would be recorded as "refused-as-expected", which is exactly the false-positive R6 must rule out.
- Required fix:
  - Pass only when `err` deep-equals `{"InstructionError":[0,{"Custom":6008}]}` (InvalidProposalStatus, raised by account validation before any CPI).
  - Record any other error as a distinct outcome (for example `refused-other-error`), and make it fail the test.

**P2-2: the receipt can say "Nothing was sent" after a send**
- Where: `…pilot-run1-complete.live.test.ts:102–111,57`.
- Problem: `out.send` is set only **after** the status poll. If `sendTransaction` throws after the transaction was broadcast (for example a 429 on the response), or `getSignatureStatuses` or `getTransaction` throws during the poll, `out.send` stays null. The `finally` then writes outcome `incomplete` and **"Nothing was sent."** The live receipt would be false and would hide a signature that may have landed. This is the same class as the parent's "generic no funds moved is unsafe" correction.
- Required fix:
  - Derive the signature from `tx.signatures[0]` (bs58) **before** `sendTransaction`.
  - Record `out.send` (status `pending`) immediately, before the call.
  - Set `out.outcome = 'unknown'` for any exception from that point on, with the signature in the receipt.
  - Never print "Nothing was sent" once a send was attempted.
- Required test: a stub test (or an equivalent offline check) for both paths.

**P3**
1. `out.commit` is `git rev-parse HEAD` without a clean-tree check. Record `git status --porcelain` emptiness, or refuse on a dirty tree, so the receipt's commit names the code that ran.
2. `send()`: a non-Error rejection whose status reads **finalized with err null** (a success) is reported as "outcome unknown". That is conservative and safe, because recovery adopts it, but the comment should say so.

## The lead's 0038b9d (my live r1 P3s)
**Rent arithmetic:** I checked it myself and it reconciles to the lamport.

| Item | Lamports |
|---|---|
| Multisig | 1,823,720 |
| Vault ATA + 2 tester ATAs (3 × 1,488,440) | 4,465,320 |
| 4 × (vault transaction 2,672,080 + proposal 2,468,880) | 20,563,840 |
| 2 wSOL accounts (2 × 1,488,440) | 2,976,880 |
| **Rent subtotal** | **29,829,760** |
| Wrapped | 10,000,000 |
| **Total** | **39,829,760** |

**My live r1 P3s:**
- **P3-1 (rent cost):** documented. ADR/quote-model follow-up still advised.
- **P3-2 (index 4):** documented as deliberate.
- **P3-3 (stranded fixtures):** documented.

None of these blocks the gate.

## Verdict
**What is approved:**
- the send() mapping;
- the runner;
- the readback script;
- the `PINNED_EVIDENCE` exception.

**What blocks the send:** the completion test must not be run until P2-1 (assert exactly Custom 6008) and P2-2 (record the signature before sending; never "Nothing was sent" after an attempt) are fixed and I have reviewed them. After that, the single targeted send may proceed. I will read the result back independently before the LIVE verdict. That verdict will cover test keys simulating every role: not real devices, not independent custody, and not production.

**Gates:** the LIVE gate remains NOT PASSED.

VERDICT: CHANGES_REQUIRED
