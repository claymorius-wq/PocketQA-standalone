# pqa-qa verdict: wallet-rewards local slice, r2 (targeted re-review)

**Candidate:** `0659ffb` (`feat/wallet-rewards`), reviewed as `git diff e38c9ab..0659ffb`: 17 files, 1 commit.

**Scope:** unchanged from r1. ADR 0007, a local **simulated** settlement only. No provider, devnet, keys or assets.

**Reviewer setup:**
- I ran everything in my own detached worktree `.worktrees/qa-wr-run`, checked out at `0659ffb`. The lead's worktree was not touched.
- No cloud or devnet calls, no subagents, no advisor.
- Scratch probes existed only in my run worktree and were deleted afterwards. Its tree is clean.

## What I ran (Node v24.21.0, at `0659ffb`)
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. `check:secrets`: 806 files, no findings. Scripts 57; contracts 17; domain **216**; API **474** passed plus 2 skipped; mobile **1069** |
| Playwright `e2e/wallet-rewards.spec.ts` | **1/1** passed. The screenshots it rewrites were restored, and the tree is clean |
| **PROBE-1 r2** (my r1 reproduction, extended through settlement) | A funded draft (3,300,000 units confirmed) plus an unpaid request, then `DELETE /me`: **200**. The study is now `closed`, the vault is **0**, and **3,300,000** units of finalized simulated refund went to the funding wallet. The books balance, with `refundedUnits = fundedUnits = 3,300,000` |
| **PROBE-5** (new) | A funding **still processing** at deletion, then deletion (**200**), then the hold lifted and 3 worker runs. The funding is `confirmed`, there is **exactly 1** refund row, 3,300,000 went to the funding wallet, the vault is 0 and the books balance |

## r1 findings
| r1 | Change | Status |
|---|---|---|
| **P2-1: funds stranded on builder deletion** | `account.ts:299-308`, **inside** the deletion transaction (265–331): for each escrow **draft** of the builder, `awaiting_payment` fundings expire, the study is closed, and `authorizeRefund` sets the vault aside for the verified funding wallet. In `escrow.ts` `verifyFunding`, a funding that confirms after its study closed is refunded at once. That's safe because only one funding can be confirmed per study and one refund is allowed per study (unique indexes). Published or paused studies still block deletion. No new retention rule. Tests: `F5b` (`escrow.test.ts:389-422`), plus my PROBE-1 r2 and PROBE-5. ADR 0007 §6 records it, and notes that unmatched deposits sent to a vault but never submitted are a **provider gate** | **fixed** |
| **P3-1: export gap** | still documented as a known gap | open, documented (non-blocking for the local slice; required before any release) |
| **P3-2: unbounded retry** | `worker.ts`: exponential backoff capped at 1 h; an alert once `attempt ≥ ESCALATE_AFTER` (5); it keeps retrying. Test at `escrow.test.ts:424` | **fixed** |
| **P3-3: vacuous network and mint** | `observeTokenTransfer(tx, expect, observedNetwork)`: the network is the adapter's own observation, and the mint is reported only when a pinned credit was seen (tests: "the network is the one the adapter observed…", "no mint is reported"). `verifyFunding` refuses to confirm without a source wallet (test at `escrow.test.ts:440`) | **fixed** |
| **P3-4: overlapping worker runs** | `server.ts:47-61`: a `settling` guard, so the server runs one pass at a time. Per-key idempotency is documented as the provider requirement | **fixed** |

## Matrix status
Rows **A–I all pass.** F5 is now complete for tester deletion (r1) and builder deletion with funded drafts or funding in flight (r2).

## Remaining (non-blocking for the local slice)
- **P3:** the account export lacks reputation and payment data (documented). Add it before any release.
- **Provider activation gates** (from my architecture review), unchanged:
  - B-2, the provider choice;
  - B-3, release authority and keys;
  - a sweep for unmatched deposits;
  - live devnet evidence with real wallets.

## Verdict
The single r1 blocker is fixed and verified by my own executed probes, and every P3 that could be fixed in this slice is fixed.

**This approves the local simulated slice at `0659ffb` only.** It is not approval for devnet or real payments, which stay behind the provider gates above.

VERDICT: APPROVE
