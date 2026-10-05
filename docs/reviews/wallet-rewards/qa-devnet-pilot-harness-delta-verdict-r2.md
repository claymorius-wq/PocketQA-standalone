# pqa-qa: Squads devnet pilot, harness delta verdict r2 (before the single completion send)

**Candidate:** `0b66267ac631671008d8cc66736cab6d79e80646`. The delta against `0038b9d` is:
- `test-live/run1Completion.ts` (new);
- the live completion test;
- `test/pilot-run1-completion.test.ts` (new);
- a comment in `rpcChain.ts`;
- docs.

My r1 verdict files were copied into the branch, and `cmp` shows them **identical** to mine.

**Setup:**
- I worked in detached `.worktrees/qa-wr-run` on Node v24.21.0.
- Read-only: no keys, no sends, no RPC calls.
- No subagents, no advisor.
- The tree was clean after my mutation probes.

## Gates I ran
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. check:secrets 849 files, no findings. Scripts 59; contracts 17; domain 216; API **572** + 2 skipped; mobile 1075 |
| My mutation: P2-1 (classifier back to `if (st.err)`) | `pilot-run1-completion.test.ts`: **4 failed** \| 8 passed. The token-failure, other-Squads-error and 6008-on-another-instruction cases are caught. Restored |
| My mutation: P2-2 (signature not recorded before broadcast) | The suite fails. Restored; then **12/12** |

## r1 findings
| r1 | Change | Status |
|---|---|---|
| **P2-1** | `sendAndClassify` passes **only** on `isDeepStrictEqual(err, {InstructionError:[0,{Custom:6008}]})`. Any other error, including an inner token failure, 6008 on another instruction, or a non-instruction error, is `unexpected-error`. Finalized with no error is `NOT-refused`. The live test throws unless the outcome is `refused-as-expected` | **fixed** |
| **P2-2** | The signature is `base58(tx.signatures[0])`, and an unsigned transaction is refused first. `send{state:'pending'}` and `outcome='unknown'` are recorded **before** `sendTransaction`. Every exception afterwards, and any status short of finalized, leaves the outcome `unknown`, with the signature and "never retry blindly". `sendLine` prints "Nothing was sent" only when `send === null`. All four exception paths are tested | **fixed** |
| **P3-1: clean tree** | `cleanTree` is recorded and **required** before any read or signing | **fixed** |
| **P3-2: rpcChain comment** | Added: "finalized without error after a non-Error rejection → unknown" | **fixed** |

## Residual (P3, non-blocking)
1. **Missing after-state on a failed outcome.** On `unexpected-error` or `NOT-refused`, the live test throws before its post-check reads, so that receipt would lack after-balances. In that case I'll read balances and the program back myself before any verdict.
2. **`getTransaction` throwing after a finalized status is recorded as `unknown`.** That's conservative and acceptable: the status is readable from the signature.

## Verdict
**APPROVE `0b66267` for the single targeted completion send:**
- **What it does:** one second execute of executed index 1 on multisig `AHj8EXYG…KNE`, signed by the Pocket QA pilot test key, with no retry.
- **What follows:** I'll then independently read back the signature, its error (expected `Custom 6008` at instruction 0), the unchanged balances (tester A 1,000,000; vault 210,000) and the unchanged program-data.
- **Roles and claims:** test keys simulate every role. This is not real devices, not independent custody, and not production.

**LIVE gate:** NOT PASSED until that readback.

VERDICT: APPROVE
