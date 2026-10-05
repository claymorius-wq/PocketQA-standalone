# Freeze candidate: reputation layer design proposal and USDC escrow research

**Branch:** `docs/reputation-escrow-proposal`. **Candidate:** `5a39a77`. Every command output in this folder ran on it, unless the file names another commit. The commit that adds this file only adds evidence and status.
**Base:** `main` at `87e09d4`.
**Scope:** docs only. No code, API, contract, data or configuration changes.

## Why
Hamza's message of 2026-10-05, relayed by claymorius-wq, set a new direction: wallet and USDC escrow payouts, plus points, badges and a leaderboard. His plan (`docs/plans/wallet-escrow-rewards-leaderboard.md`) isn't in the repo yet. These two documents are inputs for it, not decisions. Nothing here changes A9, B1, B2, the plan's Money row or any approval.

## Commits
- `45d806f` docs: the reputation layer design proposal and the USDC escrow research.
- `80d9bed` docs: fixes for docs review r1 (CHANGES_REQUIRED: 0 P1, 10 P2, 11 P3).
- `5a39a77` docs: fixes for the six P3s of docs review r2 (APPROVE), plus the design boards' review records.

## What's in it
- **`docs/research/usdc-escrow-and-anti-gaming.md`:**
  - options for holding and releasing USDC tester rewards on Solana, with a recommended devnet-only study-vault program and Squads v4 in every privileged role;
  - costs and fees, risks and the questions for counsel, and anti-gaming;
  - the link to gates A9 and B1, with the approvals needed in order;
  - every claim labelled OBSERVED, INTERPRETATION or HYPOTHESIS.
- **`docs/design/reputation-layer.md`:** the reputation layer in Lens:
  - rules, points, levels and badges (proposal values);
  - the medallion, and a proposed ninth Uplight moment (U9) with its React Native mapping;
  - the tester's You tab, the leaderboard, and the builder's view;
  - copy and accessibility, anti-gaming, and how the proposal differs from the research;
  - 15 open questions, where the layer would land in code, and the visual recipes.
- **`docs/progress.md`:** a new entry.

## Reviews
All reviewers were read-only subagents of the contributor session (Claude Code, `claude-opus-5-5`), not Hamza's `pqa-qa` pane. Their verdicts are committed verbatim.

| Review | Target | Verdict |
|---|---|---|
| `verdict-qa-r1.md` | the docs at `45d806f` | CHANGES_REQUIRED: 10 P2, 11 P3. All fixed in `80d9bed` |
| `verdict-qa-r2.md` | the docs at `80d9bed` | **APPROVE**: 20 of the r1 findings fixed and 1 partly fixed; 6 new P3s, fixed in `5a39a77` and not re-reviewed |
| `boards-critique-r1.md` | the first two design boards | 21 findings (1 P1, 9 P2, 11 P3), all fixed |
| `boards-critique-r2.md` | all five boards as one set | 23 findings (3 P1, 10 P2, 10 P3), all fixed |
| `boards-verify.md` | the final boards | 42 of 44 fixed, 2 partly; 7 P3 regressions, then fixed in a polish pass |

**Still open on the boards:**
- Promoting the six new glyphs into the main Lens glyph set waits for Hamza (design §9).
- The design canvas page "Next · reputation (proposal)" couldn't be published from the contributor session, so a private static preview of every board was published instead. claymorius-wq can share both.

## Evidence
Windows 11, Node 24.21.0, pnpm 10.32.1. Local paths are shortened to `<repo>`.

| What | File | Result |
|---|---|---|
| `pnpm check:secrets`, `assert-no-secrets --repo`, `pnpm typecheck`, `pnpm lint` | `checks.txt` | All pass: 769 files scanned with no findings; 0 preview-secret occurrences; typecheck and lint clean |
| Read-only RPC re-check of the research's on-chain facts | `research-recheck.sh`, `research-recheck.txt` | Rent, Squads v4 authority on both clusters, and both USDC mints all match the research |
| The reviewers' own checks | `qa-r1-evidence/`, `qa-r2-evidence/` | Includes the Squads program-hash comparison (`squads-binary.txt`) and a re-run of a recorded command |
| Tests | — | Not run: no code changed |

## Gates and limits
- **Docs only.** Nothing is built from this until Hamza answers the open questions and approves his plan.
- **No real money.** The research recommends devnet only. Any escrow or "smart-contract custody", even on devnet, needs the approvals listed in research §7.1.
- **CI:** this repo has none. The checks above ran on one machine.
