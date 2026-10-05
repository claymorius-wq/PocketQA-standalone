# Wallet-funded escrow and reputation: local slice evidence

**Scope:** ADR 0007. This is local **simulated** settlement: no network, no keys, no assets, and no production activation. None of this evidence shows that real or devnet payments work. Those are a later release gate (B-2, B-3 and live devnet evidence).

## Commands and output (in this folder)
| File | What |
|---|---|
| `slice1-domain-red.txt` / `-green.txt` | Escrow money model: quote, postings, invariant, payout state machine, funding verification (RED first, then GREEN) |
| `slice1-token-transfer-green.txt` | Network-free SPL funding reader: pre/post balance deltas, pinned mint, classic Token program |
| `slice1-api-red.txt` / `-green.txt` | `apps/api/test/escrow.test.ts`: pqa-qa matrix rows A–G and I |
| `slice2-reputation-red.txt` / `-green.txt`, `slice2-reputation-api-green.txt` | Points, reversals, badges, Wilson quality score, opt-in leaderboard (domain and API) |
| `slice3-money-red.txt` / `-green.txt`, `slice3-ui-green.txt` | String-only money formatting, payment-state wording, escrow and reputation screens |
| `pnpm-verify.txt` | The full gate: secrets scan, typecheck, lint, all unit suites |
| `playwright.txt` | The web E2E suite, including `e2e/wallet-rewards.spec.ts` (real browser, real local API with `POCKETQA_SETTLEMENT=simulated`) |
| `e2e-firebase.txt` | Firebase Auth emulator E2E (unchanged flows) |
| `browser/*.png` | Screens from `e2e/wallet-rewards.spec.ts`, light (builder) and dark (tester) |

## What the browser run covers
1. A builder links a wallet through the real SIWS flow, with a test Wallet Standard wallet.
2. The builder creates a wallet escrow study: 1.5 simulated USDC × 2.
3. Publishing is refused until it's funded; the builder then funds it in one press (simulated) and sees the books.
4. A tester saves a device and links a wallet. The tester can't join until both consents are checked, including the explicit payout-wallet confirmation, then submits.
5. The builder approves with "helpful". The payment state goes from pending to "Settled · simulation, no funds moved" after the settlement worker runs, and is never shown as paid.
6. The tester sees the settled state on the session and under Credits, 15 points and the First accepted test badge, opts into the leaderboard ("Not ranked yet": the minimum sample isn't reached), and opens the leaderboard.
7. The builder's books show 1.50 settled and 1.65 available, consistent with the 10% illustrative fee.

**Stability:** the spec was repeated 5/5 after a test-only navigation fix. `goBack()` after reloads was unreliable, so the spec now opens the study by its URL.

## Reviews (pqa-qa, copied from its worktree `.worktrees/qa-wallet-rewards`)
- `qa-architecture-threat-review-r1.md`: blockers B-1, B-2 and B-3. B-1 was resolved by ADR 0007 and the parent's clarification; B-2 and B-3 remain provider-activation gates.
- `qa-local-slice-test-matrix-r1.md`: rows A–I.
- `qa-local-slice-verdict-r1.md`: CHANGES_REQUIRED on `e38c9ab`, one P2 (builder deletion stranding escrowed funds).
- `qa-local-slice-verdict-r2.md`: **APPROVE** of `0659ffb`, for the local simulated slice only.

**Open before any release with real or devnet money:**
- provider gates B-2 and B-3 (audited program or provider, authorities and keys);
- a sweep for unmatched deposits;
- live devnet evidence;
- real wallets on a device.


## Release-gap follow-up (after r2)
- **Account export of payments and reputation:** ADR 0007 §9. Tests: `apps/api/test/export-wallet.test.ts` and the browser download checks in `e2e/wallet-rewards.spec.ts`. RED/GREEN in `export-red.txt` and `export-green.txt`.
- **Fraud consequences and the frozen payout wallet:** ADR 0007 §8. There is no clawback of settled transfers, and no wallet change flow; the freeze is disclosed at consent.
- **Redaction:** emulator `oobCode` and `apiKey` query values in every checked-in Firebase E2E log are now `[REDACTED]`, with pass counts unchanged. `scripts/evidence-redaction.test.mjs` keeps them redacted.
- **Export review:** `qa-wallet-rewards-export-verdict-r3.md`, APPROVE of `90506e9` with two P3s, both fixed after it:
  - the reward appears once, in `payments.received`, as string units (`participations[].payout` is null in the export);
  - the builder test includes a builder finding and states what may appear: the builder's own findings keep their participation id, and money rows carry none.

- **Export review r4:** `qa-wallet-rewards-export-verdict-r4.md`, **APPROVE** of exactly `2b069b0` (the r3 P3s, both fixed).

## Squads v4 devnet feasibility pilot (ADR 0007 §10 and §10.1)
**Status:**
- **LIVE receipt gate: PASSED.** pqa-qa live verdict r2 APPROVE (`qa-devnet-pilot-live-verdict-r2.md`), from its own read-only devnet readback.
- **Code covered:** `dc76870` (run 1) and `0b66267` (the completion send); receipts at `8f0246f`.
- **Scope stated by pqa-qa:**
  - test keys simulate every role: no real devices, no independent custody;
  - the adapter's lost-mapping protection is offline evidence only;
  - the evidence is a partial run plus one targeted completion send;
  - the devnet Squads program is upgradeable by a single key;
  - **no production, mainnet or real-funds claim.**
- **History:** OFFLINE approved `dc76870` (r2). Live run 1 stopped on a harness error (live r1 CHANGES_REQUIRED). The harness fix was approved at `0b66267` (harness-delta r2). The completion send at `0b66267` passed (live r2).

**pqa-qa reviews** (exact copies of the reviewer's files):
- `qa-devnet-pilot-test-matrix-r1.md`: the R0–R8 and C1–C10 checks.
- `qa-devnet-pilot-offline-verdict-r1.md`: CHANGES_REQUIRED on `3023657`, with the amendment that the P1-1 fix needs an on-chain operation id.
- `qa-devnet-pilot-offline-verdict-r2.md`: **APPROVE (offline only)** on `dc76870`.

**Lead evidence:**
- `pilot-adapter-tdd.txt`: RED against `3023657`; 23/23 mutants killed; GREEN 78/78.
- `pilot-verify.txt`: `pnpm verify` EXIT=0.
- `playwright.txt` and `browser/`: Playwright 15/15.
- `faucet-request.md`: public addresses, the faucet attempts, and the minimum human action.

**Live evidence:**
- `devnet-pilot-receipt-run1.{md,json}`: the raw run 1 receipt, partial.
- `devnet-pilot-run1-readback.{md,json}`: the lead's supplement and the read-only readback.
- `devnet-pilot-run1-completion.{md,json}`: the double-execute refusal.
- pqa-qa: `qa-devnet-pilot-live-verdict-r1.md`, `qa-devnet-pilot-harness-delta-verdict-r1.md` and `-r2.md`, `qa-devnet-pilot-live-verdict-r2.md`.

The pre-fix BLOCKED dry run at `5d5d431` is in Git history only (`c3a4fd0`).

**The fee:** the test platform fee stays in the study vault and is accounted for in the books and in reconciliation. No fee transfer was added (existing scope).
