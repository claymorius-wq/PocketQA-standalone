# pqa-qa: wallet-funded escrow, payouts and reputation: architecture, threat and feasibility review, r1

**Reviewer:** pqa-qa, Herdr pane `wX:p2`, `claude-opus-5-5`. 2026-10-05.

**Inputs:**
- the root `docs/plans/wallet-escrow-rewards-leaderboard.md`, which is untracked in the root checkout. I read it and didn't edit it;
- `main` `87e09d4`.

**Review worktree:** `.worktrees/qa-wallet-rewards` (branch `review/qa-wallet-rewards`, from `main`). Only `docs/reviews/wallet-rewards/qa-*` files are written here.

**Scope of this document:** design and threat review, plus a primary-source feasibility check. **This is not an implementation approval.** The final verdict needs the lead's exact frozen candidate, with my own tests.

**Amendment (2026-10-05, parent clarification; supersedes the affected r1 wording):**
- **B-1 is resolved** by a new recorded authorisation, which the lead is recording. The user explicitly approved implementation after the plan.
- **The authorised slice is local:** code, tests, UI, an isolated simulation, and read-only provider research.
  - It is **not** a public devnet program deployment, funding, key creation or real custody.
  - The provider stays **disabled** until a verified choice is made, with the exact trust model documented.
- **B-2 and B-3 remain gates for activating a real provider,** not for approving the local slice.
  - The absence of live devnet evidence prevents a live-payment release, not a local implementation approval.
  - Nothing may claim that the simulation equals an on-chain payment.
- **Wording corrections:** B-2 (inspected candidates only), the description of Covenant's model, the accounting buckets (available and pending refund added), and retention (no new retention rules overriding the account-deletion scope). Each is corrected in place below.

**Rules held:**
- read-only on the lead's worktree and the root;
- no mainnet, no funds, no credentials, no paid services;
- the only network calls were public documentation pages, public devnet JSON-RPC reads and npm registry metadata;
- no subagents and no advisor.

## 0. Blockers to settle before code (sent to the lead)

### B-1: the authorisation scope is inconsistent. **RESOLVED** by the new recorded authorisation (see the amendment; verified when the lead's record lands)
- The plan's own status line says "Status: proposed … **No application changes**, mainnet deployment, contract funding or fees **authorized by this plan**".
- The parent's brief calls this "new approved work".
- CLAUDE.md requires "No mainnet escrow/real payouts/**smart-contract custody** or paid services **without separate approval**".
- **Needed before code:** a recorded decision that states:
  - (a) devnet only, with test USDC;
  - (b) whether a **devnet escrow program deployment** counts as approved smart-contract custody for testing;
  - (c) that production stays fail-closed (no real-money mode).
- The plan file should then be committed on the feature branch with that status, because today it's untracked in the root checkout.

### B-2: no audited, suitable escrow was verified among the inspected candidates (a gate for provider activation)

This doesn't claim that no audited escrow exists anywhere. Only the candidates below were inspected.
- **Solana Pay** (primary spec, docs.solanapay.com/spec) has "no provisions for escrow functionality, conditional transaction release, or dispute resolution". It's a payment-request format only.
- **Covenant** (github.com/wienerlabs/covenant):
  - "Status: **devnet only**"; program `5hstj5grBUL1BeSaPLYpgkD6n3ALasmbseRvKRFfCVNT` on devnet;
  - "External audit planned", so the code is unaudited;
  - disputes go to a "bonded 2-of-3 multisig";
  - jobs "**auto-release after a 24h optimistic challenge window**".
  - **That is an optimistic-acceptance model:** funds release by default unless someone challenges within 24 hours. **It is not instant cashout on upload.** But it differs from the explicit builder approval the plan asks for (step 5: approval authorises exactly one payout). Adopting it would change the product rule from "paid when approved" to "paid unless challenged". That's a product decision, separate from the audit gap.
- **The choice to make, with consequences:**
  - (i) a custom on-chain program (PDA vault per study, one payout record PDA per participation). This is **devnet only and unaudited**; mainnet is blocked until an independent audit;
  - (ii) a platform-held vault key, which is **custodial**. The plan already warns against marketing it as escrow, and it needs key management and a legal or custody assessment even on devnet;
  - (iii) builder-signed direct payouts, which are non-custodial. The builder can withhold, so it needs the plan's escalation rule and doesn't fully satisfy "escrow".
- Whichever is chosen, **the UI and docs must name the trust model** (who can move funds), and must never say "trustless".

### B-3: release authority and custody of keys (a gate for provider activation)
- Every option except (iii) needs a signing key that can release funds. Decide where it lives: on devnet, a dedicated test keypair outside the repo with mode 0600, never a personal wallet.
- Decide also what it can do:
  - release only to the frozen tester destination, for an amount equal to the reserved reward;
  - refund only to the funding wallet.
- And who can trigger it: an approval or a dispute outcome, never an arbitrary admin action.

## 1. The current boundary (verified on `main`)
| Claim in the plan | Verified |
|---|---|
| Publishing reserves internal credits | `studies.ts:67-68` `post(db, planReserve(…))`, from the internal ledger |
| Approval posts `reward_credit`, not a payment | `participations.ts:22-27` `planReward({… kind: 'reward_credit' })` |
| Dispute resolution is the integration point | `admin.ts:22-47` `resolveDispute`, with outcome `overturned`/upheld and an audit |
| Transfers are devnet demonstrations, off in production | `wallet.ts:99` `devnetTransfersOn`; `features.devnetTransfers=false` in production (inc1) |

**Reusable patterns** (good, keep them):
- `rpc.ts:6,28,34`: verification at **`finalized`** commitment;
- `transfer.ts`: `verifyTransfer` binds a **server-owned** expectation (sender, recipient, exact amount, signature, time window) and refuses a non-devnet genesis;
- `SOLANA_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'` (`contracts/index.ts:424`) **matches the live devnet** `getGenesisHash` I queried;
- the existing SIWS wallet linking.

**Gap:** that verifier handles only `system` SOL transfers, and the repo has no SPL-token client. `@solana/kit` 7.1.1 is in `packages/domain`. Kit-compatible token clients on npm: `@solana-program/token` 0.17.0 (2026-09-21) and `@solana-program/token-2022` 0.19.0. A new dependency needs a version pin and a lockfile review.

## 2. Primary-source facts the design must use
| Fact | Source | Design consequence |
|---|---|---|
| **The USDC mint on Solana devnet is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`** (mainnet `EPjF…Dt1v`) | developers.circle.com/stablecoins/usdc-contract-addresses | Pin the **devnet** mint in config, with no client-supplied mint. A production or mainnet mint must be refused in this phase |
| **The devnet USDC mint account:** owner `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (classic Token program), `decimals: 6`, no extensions, **`freezeAuthority: CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT`** | live devnet `getAccountInfo` (jsonParsed, finalized) | Verify the **token program id** (refuse look-alike Token-2022 mints) and decimals 6. **The issuer can freeze any token account, including the escrow vault**, so payout and refund must handle a frozen-account failure honestly. Amounts are integers in base units (1 USDC = 1,000,000) |
| **Base fee 5,000 lamports per signature;** prioritisation fee `ceil(compute_unit_price × compute_unit_limit / 1,000,000)`; "Every Solana transaction requires a fee paid in SOL" | solana.com/docs/core/fees | The payer of SOL fees (builder, platform relayer or tester) must be decided and quoted. Payouts can't be "free" |
| **Rent:** the docs give "(account_size + 128) × 3,480 lamports/byte-year × 2 years", which for a 165-byte token account is 2,039,280 lamports. **The live devnet `getMinimumBalanceForRentExemption(165)` returned 1,488,440** | solana.com/docs/core/accounts and live devnet | **Don't hardcode rent.** Read it live at quote time. Creating a tester's associated token account costs real SOL, and someone must pay it |
| **Commitment:** `processed` "can still be rolled back"; `finalized` "maximum lockout" | solana.com/docs/rpc | Funding, payout and refund are credited only at `finalized`, as `rpc.ts` already does. Show `confirmed` as "pending" at most |
| **Solana Pay `reference`:** keys "may or may not be unique" and are found with `getSignaturesForAddress`; SPL `recipient` must be a wallet, not a token account | docs.solanapay.com/spec | If funding uses Solana Pay, the server generates a **unique** reference per funding intent and binds it in the database. Don't rely on the reference alone for idempotency; use the signature's uniqueness as well |

## 3. Threat model and the controls I'll test in the implementation
Each item lists the threat, then the required control. The code review will check each with a test I run myself.

1. **Duplicate payout or event replay.**
   - **Threats:** a double approval, worker retries, a duplicated webhook or poll event, a crash between submit and record, or reusing one funding signature for two studies.
   - **Controls:**
     - `UNIQUE(participation_id)` on payouts;
     - a payout intent state machine (`authorized → submitted(sig) → finalized | failed`) with an idempotency key equal to the participation id;
     - on chain, one payout record or PDA per participation, so a second release **fails on chain**;
     - `UNIQUE(signature)` for funding, refund and payout, with each signature bound to exactly one intent;
     - re-polling a signature never re-credits.
   - **Tests:**
     - two concurrent approvals;
     - a retry after a "submit succeeded, record failed" crash;
     - the same funding signature submitted for study B;
     - a replayed event after it has been finalized.
2. **Finality, wrong mint or wrong network.**
   - **Controls:**
     - the genesis hash equals devnet;
     - `finalized` only;
     - verify by **`meta.preTokenBalances`/`postTokenBalances` deltas**, not top-level instruction parsing alone (CPI and inner instructions can hide transfers): the vault's associated token account for the pinned mint increases by exactly the expected base units;
     - the mint equals the pinned devnet USDC and the owner program equals the classic Token program;
     - `meta.err` is null, and the block isn't older than the intent.
   - **Tests:** a Token-2022 look-alike mint with the same decimals; the correct mint sent to the wrong vault; an underpaid or overpaid amount; a `confirmed`-but-not-`finalized` transaction; a mainnet genesis.
3. **Concurrent budget reservation.**
   - **Controls:** reserving a slot happens in one SQLite write transaction that rechecks `reserved + pending_payout + paid + reward ≤ confirmed_funded − fee` and slots. better-sqlite3 transactions serialise, but the **check must be inside** the same transaction as the insert.
   - **Test:** N parallel reservations for a study with fewer free slots than N leave exactly the free count reserved, never more.
3a. **Funding and spending accounting.**
   - **Controls:**
     - a separate monetary ledger in integer base units (never the legacy test-credit ledger, never floats);
     - the invariant `funded = available + reserved + disputed (frozen) + pending_payout + paid + pending_refund + refunded (+ fee held/collected)` holds after every transition (a property test). Each bucket is non-negative;
     - the platform fee is never paid from the reward pool;
     - SOL fees and associated-token-account rent are accounted separately.
4. **Payout wallet substitution.**
   - **Threats:** a hijacked session links an attacker's wallet before approval; an admin redirects a payout.
   - **Controls:**
     - snapshot the payout destination (the wallet address, plus the derived associated token account) **at reservation or consent**, with explicit consent;
     - the payout always goes to the snapshot;
     - changing it needs re-authentication **plus a signature from the new wallet (SIWS) plus a cooldown plus an audit**, and is refused while a payout is authorised or submitted;
     - **no admin endpoint can set a destination.**
   - **Tests:** re-link after approval; a forged destination in the request body; admin dispute resolution trying to change the payee.
5. **Dispute and refund races.**
   - **Controls:**
     - a dispute freezes only that participation's reserved amount;
     - refunding at closure is computed inside one transaction and **excludes** reserved, disputed, authorised and submitted amounts;
     - a refund and a payout of the same funds are mutually exclusive state transitions;
     - an upheld dispute releases the reservation exactly once.
   - **Tests:**
     - a refund in parallel with a dispute resolution;
     - an overturned dispute after closure;
     - a double refund;
     - withdrawing or cancelling with active tasks.
6. **Custody and admin powers.**
   - **Controls:**
     - list every key and authority in an ADR: vault authority, program upgrade authority, release signer, fee recipient;
     - admins **can only decide outcomes**, never amounts or destinations;
     - every money action is audited with an actor and reason;
     - no master transfer permission in wallets (plan D);
     - no seed phrases.
   - On devnet, the program's upgrade authority and the release key are test keypairs, documented with their public keys only.
7. **Production fails closed.**
   - **Controls:**
     - a feature flag (for example `features.walletPayments`) that is **false in production**;
     - config refuses a mainnet RPC, the mainnet USDC mint, or a non-devnet genesis in this phase;
     - the existing production refusals stay (devnet transfers off, A9 publishing gate) and aren't bypassed by a "funded" path.
   - **Test:** `loadConfig` in production with the wallet-payments flag, a mainnet mint or mainnet RPC throws.
8. **No fake paid claims** (CLAUDE.md: "No … fake payment completion").
   - **Controls:**
     - the UI shows `approved → payment pending → paid (finalized on devnet, with a signature link)`, or `failed (reason)`;
     - "paid" never appears before `finalized`;
     - the asset is labelled "**devnet test USDC, no value**";
     - no earnings guarantees in copy.
   - **Tests:** a screen test for each state, and a copy check against "earn", "guaranteed" and "paid" before finalisation.
9. **Points, Sybil and privacy.**
   - **Controls:**
     - points events are append-only, **only from builder-approved participations** (never from uploading alone), and `UNIQUE(participation_id, kind)`;
     - reversal events after an upheld fraud finding, with no deletion;
     - **self-dealing blocked or flagged:** a funding wallet equal to the payout wallet, one wallet linked to both a builder and a tester account, or a builder approving testers who share its device or wallet;
     - leaderboards are **opt-in**, with pseudonymous display names, no wallet or email or evidence exposure, minimum sample sizes and recency windows, and no ranking by deposit size or raw volume;
     - points have no cash value and aren't tradeable.
   - **Tests:** a duplicate award; approving one's own alt account; an opted-out user absent from the leaderboard response; the response contains no wallet addresses.

## 4. Design notes to fix in the plan before implementation
- **Step 5,** "a smart contract cannot judge video quality": correct. So the release trigger is an off-chain decision signed by someone, and the trust in that signer must be stated (B-3).
- **Step 6,** "review inactivity … timeout rule": define the default outcome. A **timeout must not auto-pay unreviewed work** (fake submissions), and must not let the builder withhold indefinitely. Escalating to an adjudicator is the safe default.
- **Step 7,** platform-fee refund policy: needed before the accounting invariant can be written (open decision).
- **Account deletion during an open reservation, dispute or payout:** no new retention rule may override the user's account-deletion scope (A5). The payments design must handle this case within it, for example by:
  - cancelling or releasing the reservation, with the funds returning to `available` or `pending_refund`;
  - keeping only the monetary ledger records needed for accounting, with no recordings;
  - recording the outcome.

  It must not keep recordings longer than A5 allows.
- **The legacy test-credit ledger and `features.testCredits`** must stay separate from real-money accounting (plan B). Never convert between them.

## 5. What I need from the lead for the implementation review
- the exact frozen SHA, with the recorded authorisation scope (B-1) and the trust-model ADR (B-2, B-3);
- devnet-only config, with the pinned mint and genesis checks;
- the tests listed in §3, which I'll run myself;
- the devnet evidence: funding, payout, refund and dispute runs with test USDC, with signatures, labelled devnet, and no keys in the evidence.

**Status (as amended):** B-1 is resolved. B-2 and B-3 are gates for **activating a real provider**. The local slice (code, tests, UI, isolated simulation) can be reviewed and approved on its own scope, against `qa-local-slice-test-matrix-r1.md`. No implementation verdict yet.
