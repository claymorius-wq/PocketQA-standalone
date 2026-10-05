# pqa-qa: wallet-rewards combined candidate for merge to main and user testing, verdict r1

**Candidate:** `a5f0a7aea7c4ffa4b9992e286ec28c464236bf90` (`feat/wallet-rewards`), reviewed against `origin/main` = `8cc03dc0b2fbc238b708dacf72c8d9b86d9308f0` (local ref, no fetch).

**Setup:**
- I worked in detached `.worktrees/qa-wr-run` on Node v24.21.0, installed with `pnpm install --frozen-lockfile --offline`.
- No keys, no network sends, no cloud calls, no preview or storage actions.
- No subagents, no advisor.
- I read no `.env*` or `.preview*` files.
- Playwright screenshots were restored afterwards; the tree is clean.

## Coverage: every code commit on the branch has an exact review
I listed every first-parent commit `8cc03dc..a5f0a7a` touching non-docs paths. Each one falls inside a range I reviewed and approved:

| Range | Review |
|---|---|
| `a9782dc`…`2b069b0` | Local slice r1 → r2 APPROVE; export r3/r4 APPROVE |
| `5d5d431`, `a58ec6b`, `3023657` → `dc76870` | Pilot offline r1 → r2 APPROVE |
| `cc2f746`, `d1b8cf7` | Harness delta r1 |
| `0b66267` | Harness delta r2 APPROVE |
| `8f0246f`, `23b9221` | Scanner hash pins only. `23b9221` pins the copy of my live r2 verdict. `cmp` shows it is identical to mine, and its sha256 is `a2828474…cb8`, as pinned |
| `9dfb376` | **New, reviewed below** |

**The merge `a85c674` (origin/main `8cc03dc`):**
- It changes no non-docs path: `git diff --stat a85c674^1 a85c674 -- . ':!docs'` is empty.
- Main's side since the merge base is docs only.
- `git diff 8cc03dc a85c674 -- docs/progress.md docs/verification.md` removes **0** of main's lines, so both sides are kept.

## New code (`git diff 23b9221..a5f0a7a -- apps scripts packages`: 4 files)
| Change | Check | Result |
|---|---|---|
| `config.ts`: shared demo plus `squads_devnet` → `ConfigError` | Test A1c, plus my own `loadConfig` probe. Shared demo + `squads_devnet` → **refused**. Shared demo + simulated + a stray `POCKETQA_SETTLEMENT_PILOT_KEYS_DIR` (for example from `.env.local`) → **refused** by the existing provider-key rule. Shared demo + simulated → `simulated` | ✅ fail-closed on both paths |
| `start.sh`: `PREVIEW_SETTLEMENT` | Allowed values are `simulated` (default) and `off`; anything else exits 2 before start. `POCKETQA_SETTLEMENT` is set on the API command itself, which overrides `.env.local`, since `server.ts:13` lets the process env win. `env -u POCKETQA_SETTLEMENT_PILOT_KEYS_DIR`. I ran it with `PREVIEW_SETTLEMENT=squads_devnet`: **exit=2** and the stated message | ✅ |
| `preview-scripts.test.mjs` | Asserts the pins, the `-u`, the case statement, no executable `squads_devnet`, and a real exit 2 | ✅ |
| `user-test-preview.md` | States that preview escrow is the **labelled simulation** with no funds moved. Says plainly that the pilot is not on the preview and that a user-held-wallet pilot is **not built** (no fake connect). The rebuild uses PID-scoped stop, DB backup outside the repo, no R2 action, and keeps the root's local files | ✅ honest and scoped |

## Gates I ran on `a5f0a7a`
| Check | Result |
|---|---|
| `pnpm verify` | **EXIT=0**. check:secrets **873** files, no findings (the lead's 872 was before the last docs commit). Scripts **60/60**; contracts 17; domain 216; API **573** + 2 skipped; mobile 1075 |
| Playwright, full (`pnpm --filter @pocket-qa/mobile exec playwright test`) | **15/15**, PW_EXIT=0, including `wallet-rewards.spec.ts`: funded (simulated), tester frozen wallet, approval settles once, reputation updates |
| `start.sh` with the pilot requested | exit 2, nothing started |

**Not re-run by me:**
- the lead's isolated preview rehearsal (smoke 20/20) and the v4→v7 DB upgrade. I read no `.preview*` state;
- the live devnet tests, which skip without their flags. The live pilot verdict stands as r2.

## Residual notes (P3, non-blocking)
1. **Backup step (guide step 2).** If the root `.env.local` contains `POCKETQA_SETTLEMENT_PILOT_KEYS_DIR`, the backup command fails closed with a config refusal. That is safe, but the guide could add `env -u POCKETQA_SETTLEMENT_PILOT_KEYS_DIR` for parity with `start.sh`.
2. **Carried forward from earlier verdicts (documented):**
   - O(n) recovery scan;
   - non-reclaimable pilot rent per payment;
   - index 4 left Active;
   - stranded pilot fixtures;
   - devnet Squads single-key upgradeable.

## Verdict
**APPROVE `a5f0a7aea7c4ffa4b9992e286ec28c464236bf90`** for merge to main by the parent and for Hamza's user test of the **labelled simulation** on the protected preview.

**What this approval is not:**
- It does not approve real funds, mainnet, a user-held-wallet pilot, or running the Squads pilot on the preview, which the code now refuses.
- The devnet pilot approval stays as scoped in live r2: test keys simulate every role, it is not independent custody, and it is not production.

VERDICT: APPROVE
