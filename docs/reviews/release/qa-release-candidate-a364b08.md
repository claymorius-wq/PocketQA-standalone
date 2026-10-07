# pqa-qa: FINAL VERDICT, release candidate feat/demo-showcase a364b08 (devnet + demo scope)

**Verdict: APPROVE the candidate. This is NOT a merge approval.** `main` = `daf0c85`. a364b08 is **not** on main. Merging needs reviewed PRs (pqa-ios plan 1fc6649) and Hamza's go, with the scoped reshareai GH_TOKEN (CLAUDE.md).

## Identity
- **a364b08 = 6fb9e3e + docs only.** `git diff 6fb9e3e a364b08 -- apps packages scripts` is **empty**. The 10 changed files are evidence copies: lint-only headers, and the wallet-log signatures turned into prefix + sha256.
- **Contains:**
  - bf62c47 (wallet-tx builders);
  - 2cab74f / 4ee4603 (the web devnet client + fee vote);
  - **c3c0c8e + dc01238** (spend true-down, arbiter fee floor, P3-SR1);
  - the demo showcase (6947991 … 6fb9e3e);
  - feat/firebase-vercel d870403 (H-33 fix, etc.).
- **Served candidate artifact:** built from **6fb9e3e** (identical code), `entry-47f56763760474f397b9b75f007c8bb1.js`. **Bound by me:** the served bytes' sha256 `5c35977c…` = my own export. PID 21391 on 127.0.0.1:8697, `POCKETQA_DEMO_SHOWCASE=1`.

## My checks at a364b08 (new worktree `.worktrees/qa-cand-a364b08`, clean, `git status --porcelain` = 0)
| Gate | Result |
|---|---|
| `pnpm check:secrets` | **PASS**, 1660 committable files, no findings |
| `pnpm lint` | **PASS** (exit 0) |
| `pnpm typecheck` | **PASS** (exit 0) |

My earlier runs at 6fb9e3e (same code), in a new worktree:

| Suite | Result |
|---|---|
| mobile (review-screen + demo) | 35/35 |
| API (demo, config, production-features, authz) | 372/372 |
| emulator `devnet.demo` | 7/7 |
| mutants | caught |

## pqa-be2 clean full regression of 6fb9e3e (0e17956, evidence sha256 3e548edc…)
A clean worktree, status 0 before and after.

| Suite | Result |
|---|---|
| scripts | 93 |
| contracts | 17 |
| domain | 301 |
| api | 831 (+2 skipped) |
| mobile | 1477 |
| typecheck | 0 |

- The secret-scan and lint failures were **only in `docs/` evidence**, and are fixed in a364b08 (I confirmed it passes).
- **Emulator:** 693 passed, **1 intermittent** failure: `evidence.repo` row 4. Under contention, one losing upload gets `CONFLICT_STATE "busy"` instead of "already uploaded". It passes alone 4 of 6 times.
  - The **data invariant held** (exactly one evidence row).
  - The code is the firebase-vercel line (already in production), not devnet.
- **Rated P3-T2** (the same family as P3-T1). Owner decision: widen the transaction retry budget, or accept "busy" as a valid loser outcome. **Not a blocker:** no integrity loss, and a user retry resolves it.

## Demo showcase acceptance (A–F): PASS
| Bar | Result | Evidence |
|---|---|---|
| A, isolation | PASS | Emulator: the delta is demoProfiles +12 only. Live, `qa-prod-delta.ts`: 28 production root collections, createdSince 0, **no root `demoProfiles`**. In the namespace, demoProfiles = 12. |
| B, real ranking unchanged | PASS | The emulator B1 test is non-vacuous. **Live it's vacuous** (C-1: the devnet real leaderboard is empty, so it proves only that nothing leaked). |
| C, flag gating | PASS | refused outside devnet; 404 when off; the seed CLI is gated |
| D, idempotent | PASS | live run 1 wrote 12, run 2 wrote 0 / unchanged 12; a differing doc refused; no delete path |
| E, labels | PASS | screenshots, desktop 1280×900 + mobile 390×844: the exact title, a DEMO pill + "not a real user" per row, modest figures, no rank/money/actions, the toggle off hides the list, below the (empty) real ranking |
| F, live | PASS | `/leaderboard` + `/me/reputation` sha256 identical pre/post; prod integrity counts identical; **0 chain signatures** |

## Devnet evidence carried by this candidate's lineage (each independently read back on chain by me)
| Run | Built from | Result |
|---|---|---|
| E-28 fresh single pass | 2cab74f | PASS |
| E-29 dispute | 4ee4603 (server) + the candidate CLI | PASS |
| Web journeys, desktop + Pixel 7 viewport | 4ee4603 | PASS |
| Codex real-browser journey | 4ee4603 | PASS |
| Cleanups / finishes | — | PASS |

- **Wallet:** every signature came from **fixture keys via an injected wallet or scripted signers.** None is a real-extension claim.
- **Not yet exercised live on the 6fb9e3e artifact:** a payment journey. So **the c3c0c8e exact-books true-down is in the candidate but unproven on live devnet** (L-15). Its emulator suites are 150/150 (be2), plus the clean regression above.

## Open items that remain (explicit, none hidden)
**P3s:**

| ID | Item |
|---|---|
| P3-D4 | the alias guard misses U+1D05 / U+A4D3 look-alikes |
| P3-T1 / T2 | contention-test flakes |
| P3-W1 | signing is possible when the devnet read is unavailable |
| P3-W2 | the fee recipient isn't pinned client-side |
| P3-C1 / C4 | harness account sets |
| P3-N1 | non-monotonic audio dts |
| P3-R1-style | harness notes |

**Gates and limits (matrix rows):**

| Row | Item |
|---|---|
| L-04 | human Google login |
| L-12 | real wallet extension / MWA (BLOCKED) |
| L-13 | independent custody (NOT OFFERED: one custodian) |
| L-14 | `pocketqa.optijara.ai` 502 (the parent's tunnel) |
| L-10 | Vercel preview |
| P-03b, P-13 (fix re-verification), P-16b, P-19..P-21 | Seeker device rows |
| L-11 | the USB API recovery decision |
| L-15 | exact books live |
| C-11 / D-07 | mainnet out of scope |
| L-08 | **nothing merged** |

**Unrecoverable test tokens:** the 0.50 devnet test USDC sent to keyless throwaways (`Bp8jEPny…`; any future use of `56vXnb5p…`) is unspendable. It has no value.

## Signed
pqa-qa (independent QA/security reviewer). Read-only throughout. No deletions since the parent's halt; my only additions are new worktrees + review files.

---
## ADDENDUM: L-15 (exact spend books) PROVEN LIVE on the candidate artifact (pqa-qa readback, 2026-10-07 ~11:55Z)
**Run:** be2's E-28 single pass (harness bd461d3 = e2fd07e4), 11:47:32–11:51:20Z, on the **candidate artifact** (6fb9e3e = a364b08 code).
- **Re-bound:** the listener = the PID file = **26611**; the served `entry-47f56763…` bytes = `5c35977c…` (= my 6fb9e3e export).

**Study `f4f15afb…`** (my `qa-study-readback.mts` + `qa-e28-readback.py`; run data `docs/reviews/devnet/qa-run-l15-f4f15afb.json`; payout destination read from vault transaction #1 on chain):
- vault `LqTDQCLz…` = ATA(vaultPda(multisig `H8caU8Lb…`)); the multisig is the pinned 2-of-3, `transactionIndex` 3;
- **#1 payout** 10 000 → `Cwtt1THY…` (the harness's fresh tester), memo `b84b83ea…`;
- **#2 fee** 1 000 → the fee wallet (**recomputed**);
- **#3 refund** 11 000 → the builder (**recomputed**);
- each **Executed** [builder, platform], 1/0/1/1/0. **#4 absent. Vault 0.**
- **Ledger ok true** (27 transactions), each row exactly once with its memo:

  | Row | Amount | Transaction |
  |---|---|---|
  | funding | 22 000 | `44XkqxPH` |
  | payout | 10 000 | `56Vo68uc` |
  | refund | 11 000 | `58pb4s1i` |
  | fee | 1 000 | `5a72ChcQ` |

  Program data unchanged.
- **Platform window from 11:43:24Z: 15 signatures** (MultisigCreateV2 1, ATA 2, VaultTransactionCreate 3, ProposalCreate 3, ProposalApprove 3, VaultTransactionExecute 3), **0 outside the study, 0 failed**, net **20 303 480 lamports** on chain.

**Books vs chain** (the lead's read-only `devnetSpend` global = user):

| Time | Lamports | Test-USDC units |
|---|---|---|
| 11:43:24Z | 170 449 200 | 4 510 000 |
| 11:52:23Z | 190 752 680 | 4 532 000 |

- **The recorded delta is 20 303 480 lamports = the on-chain platform spend in the window, EXACTLY** (0 lamport difference).
- **USDC +22 000** = this run's funding.
- **This proves c3c0c8e's true-down live:** for operations run on this artifact, the books equal the chain to the lamport.
- The historic over-count from runs on earlier artifacts stays in the cumulative total by design (no edits). The cap remains fail-safe.

**Run 1** (the lead's env error, `E28_BASE_URL` with `/api`) stopped at step 0. **Nothing signed** (the lead's chain check; my window shows only this run's 15).

**L-15 = PASS (exact books live).** The candidate verdict above stands: **APPROVE a364b08 (devnet + demo scope); NOT a merge approval.**
