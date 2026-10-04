# 0007: Wallet-funded escrow: scope, trust model and settlement boundary

**Status:** accepted for the **simulated** phase, 2026-10-05.

**Sources:**
- Plan: `docs/plans/wallet-escrow-rewards-leaderboard.md`.
- pqa-qa architecture and threat review r1. It is kept in pqa-qa's worktree, `.worktrees/qa-wallet-rewards/docs/reviews/wallet-rewards/qa-architecture-threat-review-r1.md`, and answered here as B-1 to B-3.

## 1. What is authorised (B-1)
Hamza approved implementation on 2026-10-05, relayed by the parent ("nice lets go work on it!!!"). The brief's exact limits:
- **In scope:**
  - substantive vertical slices for the funding, reservation, approval, payout, refund and dispute state machine;
  - durable, idempotent settlement and reconciliation boundaries;
  - a fail-closed production gate;
  - app and API integration;
  - quality-based points, and an opt-in leaderboard with badges;
  - research of escrow candidates from primary sources before any contract is chosen.
- **Explicitly excluded:** mainnet, real funds, cloud credential access, paid services, production activation, a preview restart, push or merge.
- **Required:** "explicitly distinguish local simulated settlement from live devnet and real money, never call simulation paid".

**The parent's clarification after pqa-qa r1** (2026-10-05) resolves B-1:
- Hamza's latest approval supersedes the plan-only status **for implementation**.
- **Authorised now:** local code, tests, read-only provider and RPC research, isolated test fixtures, app and UI work, and durable settlement boundaries.
- **Not approved:** public devnet program deployment, funding or key creation. There is no real custody.
- Program logic may be built locally with local test keys only if necessary.
- B-2 and B-3 remain **production and provider gates**, not reasons to halt the local slice.
- QA's live-devnet evidence is a later release gate.

**This phase therefore builds and ships only local simulated settlement.** The devnet or real provider adapter is **disabled until a verified provider or program is chosen and approved**. No such adapter exists in code, and config refuses every value except `off` and `simulated`. Nothing in it holds keys, signs transactions, contacts a network or moves any asset.

**Not authorised by this decision, so a separate recorded approval is needed:**
- **Smart-contract custody.** CLAUDE.md says: "No mainnet escrow/real payouts/smart-contract custody … without separate approval." That includes:
  - deploying a devnet escrow program;
  - creating a platform-held devnet release key;
  - any live devnet test-USDC transfer flow.
- Mainnet, a real-money mode, production activation, and fees that are actually charged.

**Production fails closed.**
- `POCKETQA_SETTLEMENT` can be `off` (the default) or `simulated`.
- **Production refuses `simulated`.** No other value exists yet.
- Escrow studies can't be created while settlement is `off`, and the existing production gates (A9 publishing, devnet transfers off) are untouched.

## 2. Escrow candidates, from primary sources (B-2)
pqa-qa verified these and I re-read the sources it cited:

| Candidate | What it is | Fit |
|---|---|---|
| **Solana Pay** (docs.solanapay.com/spec) | A payment-request format. The spec has no provisions for escrow, conditional release or dispute resolution | Usable later as the *funding request* format (unique reference per intent), **not** as escrow |
| **Covenant** (github.com/wienerlabs/covenant) | Conditional job escrow. Devnet only; an external audit is only "planned". Disputes go to a bonded 2-of-3 multisig. **Optimistic acceptance:** a job auto-releases after a 24 h challenge window unless it is challenged | **Not suitable as is.** It is unaudited, and optimistic acceptance pays unless the builder acts. That differs from this plan's explicit builder approval before payment (it is not an instant cashout, but it is not approval either). pqa-qa found no audited, suitable escrow among the inspected candidates |
| **(i) Custom escrow program** (PDA vault per study, one payout record PDA per participation) | Funds are held by a program. A release authority triggers payouts only to the frozen destination for the exact reserved amount; refunds go only to the funding source | **Candidate model.** Unaudited, so devnet only; mainnet stays blocked until an independent audit. Deploying it on devnet needs the separate custody approval above |
| **(ii) Platform-held vault key** | A plain wallet that Pocket QA controls | Custodial. It must never be called escrow or trustless, and it needs key management and a legal or custody assessment |
| **(iii) Builder-signed direct payouts** | The builder pays each approved tester from their own wallet | Non-custodial, but the builder can withhold payment, so it isn't escrow. It is the existing devnet demo transfer, extended |

**The candidate trust model is (i).** The simulated provider is written to enforce the same rules (1)–(4) below, so swapping in a devnet adapter later changes the provider, not the state machine. **No contract is selected or deployed.**

The UI and docs name the trust model in plain words:
- "Funds are held in a study escrow. Pocket QA can release a reward only to the tester's saved wallet, for the exact reward, after the builder approves or a dispute is decided."
- The word "trustless" is never used.

## 3. Authorities and keys (B-3)
1. **Release:** triggered only by a builder approval, an admin's stuck-work decision, or an overturned dispute.
   - The amount is the reward frozen at study creation.
   - The destination is the payout wallet frozen at consent.
   - No API takes an amount or destination for a payout. **Admins decide outcomes, never amounts or destinations.**
2. **Refund:** only after the study is closed, and only the vault balance: unused rewards plus their unearned fees, after every hold has settled.
   - It goes only to the wallet that funded the study, recorded from the verified funding transfer.
   - It is pending (`refund_pending`) until the settlement provider confirms it, the same way payouts are.
3. **Destination changes:** none in this phase. The payout wallet is frozen at consent, and re-linking a different wallet later doesn't change existing participations. A controlled recovery flow (re-authentication, signature from the new wallet, cooldown, audit, refused while a payout is in flight) is future work.
4. **Fee:** the platform fee is earned per approved test. It comes from the fee portion the builder funded, never from the reward pool.
5. **Keys:** none exist in this phase. If (i) is approved for devnet, the ADR amendment must list:
   - the program upgrade authority;
   - the release signer (a dedicated test keypair outside the repo, mode 0600, never a personal wallet);
   - the fee recipient;
   
   by public key only.

## 4. Settlement boundary
`apps/api/src/settlement/` defines a `SettlementProvider`. The state machine and the ledger never call a network directly.

**Funding and payout verification:** a transfer counts only when it is final and matches the server-owned expectation exactly: network, mint, recipient, amount, reference and time. `verifyFundingTransfer` in `@pocket-qa/domain` does this check.

**Facts a devnet adapter must use** (pqa-qa §2):
- the devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, under the classic Token program, with 6 decimals;
- that mint has a **freeze authority**;
- read rent live, don't hardcode it;
- accept only `finalized`;
- compute amounts from `meta.pre/postTokenBalances` deltas, not from top-level instruction parsing.

**Simulated provider:** a local table stands in for a chain.
- Every row and every UI label says **SIMULATED**.
- Simulated USDC (`SIM-USDC`) has no value, and no asset moves.
- A confirmed simulated payout is shown as "Settled (simulated)", **never "paid"**.

## 5. Accounting
`@pocket-qa/domain` `escrow.ts` defines a separate double-entry ledger, `escrow_ledger`, in integer token base units.
- It is never mixed with the test-credit ledger or with points.
- Idempotency comes from unique indexes:
  - one funding credit per funding;
  - one authorisation per participation;
  - one settlement per participation;
  - one refund per study;
  - `UNIQUE(signature)` for funding and payouts.
- Reservations are checked inside the same SQLite write transaction that creates them.
- **The invariant** (`escrowInvariant`) holds after every transition and is checked in tests and by the reconciliation pass:

  funded = available + held + payable (approved, payment pending) + settled + platform fees + pending refund + refunded

**Open product decisions** (from the plan, not decided here):
- **Platform fee:** provisional and configurable, `POCKETQA_ESCROW_FEE_BPS`, default 1000 (10%, illustrative).
- **Who pays SOL fees and account rent:** not applicable to the simulation.
- **Review timeout:** the existing stuck-work escalation to an admin; never auto-pay.
- **Also open:** eligible countries, payout minimums and batching.
