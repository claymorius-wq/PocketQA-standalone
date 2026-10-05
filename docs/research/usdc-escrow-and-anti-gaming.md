# Pocket QA: USDC reward escrow on Solana, and honest reputation

For Hamza · 2026-10-05 · research for a devnet-first build · not legal advice

> **Status: research, not a decision.** Nothing here changes the plan, the ledger or any approval. The plan still says "No escrow, custody, smart contracts, real payouts, or paid services" (`docs/plans/pocket-qa-execution-plan.md`), and production gate A9 is still open (§7.1).
>
> **The request.** Hamza's message of 2026-10-05, relayed by claymorius-wq, asked for this escrow direction. In his words: "We should reuse a suitable audited escrow system if we can verify one, rather than rush a custom contract holding real money."
>
> **Provenance.**
> - Written on 2026-10-05 for claymorius-wq by a research subagent of the contributor session (Claude Code, `claude-opus-5-5`). It read the repo and the chain read-only. No transaction was sent and no account was created.
> - The session lead re-checked these claims: rent; the Squads v4 upgrade authority on both clusters; both USDC mints; the Civic Pass end dates; Streamflow's fees; and the SIMD-0437 schedule.
> - A separate review re-checked 18 claims. Both checks and their output are in `docs/reviews/reputation-proposal/`.
>
> **Related.** The product proposal for points, badges and the leaderboard is [`docs/design/reputation-layer.md`](../design/reputation-layer.md). Where it differs from §6 here, it governs for the product; its §8 lists each difference.

**Labels**
- **OBSERVED:** seen in a primary source. [S#] points to §8 (all sources accessed 2026-10-05).
- **[S1]:** my own read-only queries to Solana's public RPC. No transactions were sent.
- **INTERPRETATION:** my reading of the evidence.
- **HYPOTHESIS:** a design choice or number to test.
- **Unverified:** I looked and could not confirm it.

A label at the start of a list, table or subsection covers all of it, unless an item is marked otherwise.

## 1. TL;DR

1. **Recommendation (INTERPRETATION):** for devnet v1, build a small Anchor escrow program (a "study vault") whose code enforces the money rules.
   - Squads v4 multisigs hold every privileged role: arbiter, config, upgrades and treasury.
   - Builders fund and approve from their own wallets.
   - Testers sign to bind their payout wallet.
   - Admins can only "pay the tester of record" or "return to pool".
   - Points stay off-chain.
2. **No audited off-the-shelf escrow fits (INTERPRETATION; I can't prove none exists).** Squads v4 is the best-audited building block: four firms reviewed it in 2023–2024, and **on mainnet** it has been immutable since November 2024 (OBSERVED [S2][S4][S6][S1]).
   - **On devnet,** where a pilot would run, the same program is still upgradeable and runs a different binary (OBSERVED [S1]). Devnet results therefore don't validate the audited mainnet build (§3.5).
   - Squads controls *who signs*, not *where money goes*. Whoever can outvote the builder can send funds anywhere.
3. **This respects Hamza's preference: "rather than rush a custom contract holding real money" (INTERPRETATION).**
   - The pilot holds only devnet USDC.
   - Mainnet waits for an audit, caps, monitoring, legal review and your approvals (§3.5, §7.1).
   - If you want no custom code at all, the fallback is a Squads 2-of-3 vault (§3.6).
4. **Ruled out:**
   - Streamflow costs 0.16 SOL per contract plus 0.19% (OBSERVED [S14]).
   - Token-2022 extensions don't apply: USDC is a classic SPL Token mint (OBSERVED [S1]).
5. **Hidden cost: rent for each tester's USDC account.** It is 0.00148844 SOL today (OBSERVED [S1]). At an assumed $100/SOL, that is about 15% of a 1 USDC reward (HYPOTHESIS). SIMD-0437 should cut it about 7× around November 2026 (OBSERVED [S31]).
6. **Anti-gaming:**
   - Civic Pass is shut down (OBSERVED [S49]).
   - The Seeker Genesis Token proves device ownership, not personhood, and the repo plan lists it as out of scope (OBSERVED [S56]).
   - Use tiered identity, hash flags, pair caps, a points hold and Wilson-bound reliability (INTERPRETATION).
7. **A9/B1 (§7.1):** a devnet pilot fits beside either A9 option. But the plan bans escrow and smart contracts outright (OBSERVED [S56]), so the pilot needs a plan amendment first (INTERPRETATION).

## 2. Options compared

Cells without a label are INTERPRETATION.

| Option | Custody: who can move funds | Audits | Maturity | Fit: release / hold / refund / fee | Cost per payout | Devnet | Effort | Main risk |
|---|---|---|---|---|---|---|---|---|
| **A. Custom study vault + Squads roles** (recommended) | Program rules. Admins can choose only between the tester of record and the pool. The upgrade key can change the rules | None yet; required before mainnet | New | Exact fit, on-chain | 1 batchable tx, plus tester account rent if missing | Yes | High: Rust/Anchor, tests, audit | Bugs; upgrade key |
| **B. Squads v4 vault as escrow** | Anyone who reaches the threshold, to any address. Spending limits allow capped transfers without a vote; an empty destination list means "any address". Time lock up to 3 months. Approved payouts can be cancelled by a threshold vote (OBSERVED [S5][S34]) | Trail of Bits 2023-10-19; OtterSec 2023 and 2024; Neodyme through 2024-12-10; Certora with formal verification through 2024-11 (OBSERVED [S2][S6]). Mainnet upgrade authority null; on devnet it is set, and the binary differs (OBSERVED [S1]). OtterSec verify API: "not verified" (OBSERVED [S7]) | Live since Oct 2023; Squads claims ~$10B secured (OBSERVED [S4]) | Proposals per payout batch; a hold means not proposing. The rules live off-chain | On-chain creation fee 0 (OBSERVED [S1]); the app docs cite 0.1 SOL (OBSERVED [S8]); ~3–4 txs per batch | Yes (OBSERVED [S3]) | Medium: `@sqds/multisig` (OBSERVED [S9]) | Pocket QA keys can outvote the builder and pay anyone |
| **C. Squads Smart Account** | Policies, including direct debits (OBSERVED [S10]) | OtterSec 2025-05-21; Certora Jan 2025, v0.1 (OBSERVED [S11]) | Newer; upgradeable (OBSERVED [S1]) | No arbiter-escrow policy found (unverified) | Not researched | Yes (OBSERVED [S10]) | Medium–high | Young |
| **D. Streamflow vesting** | Escrow per contract. The sender may cancel: unlocked funds go to the recipient, locked funds return to the sender (OBSERVED [S12]) | Neodyme 2024-05-16: nothing medium or above (OBSERVED [S12]). FYEO and OPCODES, undated (OBSERVED [S13]) | Upgradeable; a 3-of-5 Squads multisig held the key in 2024 (OBSERVED [S12][S1]) | Poor: time-based unlocks, fixed recipient, no arbiter | 0.16 SOL + 0.19% (OBSERVED [S14]); the SDK says 0.09 SOL (OBSERVED [S15]) | Yes (OBSERVED [S15]) | Low–medium | Costs more than the reward |
| **E. Solana Pay** | None. Transaction requests return a server-built transaction, optionally partly signed (OBSERVED [S16]) | n/a | A spec | Funding only; the spec covers no escrow or refunds (OBSERVED [S16]) | Network fees | Yes | Low | Wallets warn on PDA recipients (OBSERVED [S17]) |
| **F. Token delegate / Token-2022** | Builder keeps the funds; one capped delegate per account (OBSERVED [S18]) | n/a | SPL Token | Not escrow: the builder can revoke. Extensions can't be added to Token-program mints (OBSERVED [S19]) such as USDC (OBSERVED [S1]) | Network fees | Yes | Low | No guarantee for testers |
| **G. Custodial APIs** | Circle developer-controlled wallets (OBSERVED [S20]); Bridge custody after KYC/KYB (OBSERVED [S21]); Stripe payouts from a fiat balance (OBSERVED [S22]); Squads Grid, self-custody or hybrid (OBSERVED [S23]) | Not evaluated | Stripe: private preview, US platforms only (OBSERVED [S22]) | Escrow logic sits in your ledger | Unverified | Circle: SOL-DEVNET (OBSERVED [S20]) | Medium | Lock-in; legal questions remain |
| **H. Bounty escrows** | Gibwork's escrow doesn't arbitrate (OBSERVED [S24]). Superteam Earn sponsors pay directly (OBSERVED [S25]) | Gibwork: none found | Live | Products, not building blocks | — | — | — | No arbitration |

Helper: the Kora fee relayer lets users pay fees in USDC. It was audited by Runtime Verification (2025-11-19), but `main` may include unaudited code (OBSERVED [S26]).

## 3. Recommended architecture (devnet v1)

§3 is INTERPRETATION (design). Windows and counts are HYPOTHESIS.

### 3.1 Who signs what

| Action | Signer | Fee payer |
|---|---|---|
| Fund the study (rewards + fee) | Builder's wallet, via a Solana Pay transaction request | Builder |
| Submit (binds the payout wallet); open a dispute | Tester's wallet | Service |
| Approve (batched); reject with a reason hash | Builder's wallet | Service |
| Resolve a dispute or an escalated timeout | Arbiter: Squads v4 multisig, 2 admin hardware keys | Service |
| Finalize a rejection; timeout fallback | Anyone | Service |
| Close the study and refund | Builder (anyone after the end date) | Builder |
| Config changes, upgrades | Admin Squads multisig with a time lock | Admin |

The service key pays fees and rent, but it has no authority over funds.

### 3.2 State and invariants

**Accounts**
- **Config:** USDC mint, treasury (a Squads vault), arbiter, caps.
- **Study:** builder, reward and fee per slot, counters, windows, end time.
- **Vault:** a USDC account owned by the study's PDA.
- **Submission:** tester wallet, status, timestamps, reason and evidence hashes. Closed after settlement.

**Invariants**
- The vault covers every unsettled slot.
- USDC leaves only to the tester of record, the builder or the treasury.
- Each submission pays out once.

**Devnet:** use the USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Circle's faucet gives 20 USDC per address every 2 hours (OBSERVED [S27][S28]).

### 3.3 Flow

1. The builder drafts "10 × 1 USDC". The app shows 10 USDC + 10% fee = 11 USDC, plus network costs.
2. **Fund.** The builder signs `fund_study`, and 11 USDC moves into the vault. A transaction request is used because a plain transfer request derives a wallet's token account (OBSERVED [S16]), and wallets should double-check PDA recipients (OBSERVED [S17]).
3. **Identity, recording, upload.** The tester passes the identity gate (§6.1), records and uploads. The server stores hashes of the files.
4. **Submit.** The tester signs `submit`, which reserves a slot.
5. **Approve.** The builder signs `approve([ids])`. Each tester gets 1 USDC (an account is created if missing), and the treasury gets 0.10 USDC.
6. **Reject.** The builder signs `reject(id, reason_hash)`. The dispute window opens: 7 days in the repo today (`DISPUTE_WINDOW_MS`, which applies only to rejections). Its length on chain is a decision for Hamza.
7. **Dispute.** The tester signs `open_dispute`. The funds stay reserved.
8. **Resolve.** The arbiter runs `resolve(id, PayTester | ReturnToPool)`. There is no other destination.
9. **No response.**
   - After 7 days, anyone can call `escalate`, and the admins decide.
   - After a 30-day fallback, anyone can call `timeout_settle`, which applies your chosen default.
   - Mechanical Turk similarly auto-approves after a delay unless the requester rejects (OBSERVED [S39]).
10. **Unchallenged rejection.** When the window ends, `finalize_rejection` returns the slot to the pool.
11. **Close.** After the end date, `close_study` refunds unused rewards and unused fee, and returns rent.
12. **Points.** Credited off-chain, for settled outcomes only (§6.4).

### 3.4 Transaction states

- **Pending:** a blockhash lives about 60–90 seconds, so track `lastValidBlockHeight` (OBSERVED [S32]).
- **Confirmed:** show it at `confirmed`, but book money at `finalized`, which has no fork risk (OBSERVED [S32]).
- **Failed or expired:** rebuild the transaction and re-sign.

This matches the repo's `pending → confirmed | failed | expired`, where only server verification sets `confirmed` (OBSERVED [S56]). The server should re-read the vault and submission accounts before setting it.

### 3.5 Gates before mainnet

1. A written spec, the invariants and a threat model.
2. Unit, integration and fuzz tests, plus at least 20 end-to-end devnet studies on real devices, including a Seeker.
3. An external audit of the exact commit, fixes re-reviewed, and the report published.
   - Comparable Solana auditors: OtterSec, Neodyme, Trail of Bits, Certora, FYEO and OPCODES (OBSERVED [S2][S13]).
   - Price by quote (unverified).
   - Areta's $1M subsidy covers up to 30% of a quote (OBSERVED [S35]). Whether it is still open is unverified.
4. A verified build, and the upgrade authority in a multisig with a time lock (OBSERVED recommendation [S36]).
5. Arbiter, config and treasury keys on hardware.
6. Caps per study and in total. A pause must never block refunds or settled payouts.
7. Alerts, a daily chain-to-ledger reconciliation, and an incident runbook.
8. Legal sign-off (§5.2), and published refund and dispute rules.
9. Your written approvals (§7.1).
10. **A re-check of the exact mainnet binaries.** Devnet results don't validate mainnet.
    - On devnet, Squads v4 (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`) still has an upgrade authority (`HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`). Its last deploy was at slot 446,638,068, a different binary from mainnet's frozen one, deployed at slot 302,582,236 (OBSERVED [S1]).
    - Before any mainnet step, confirm the hash and authority of every program the vault relies on.

### 3.6 Fallback: Squads only

- One v4 multisig per builder, with a vault index per study.
- Members: the builder, the service and one admin. Threshold: 2.
- A 24-hour time lock, during which any two members can cancel an approved payout (OBSERVED [S5][S34]).
- The builder and the service release payouts and refunds. The service and the admin resolve disputes.

The cost: the service and the admin can pay anyone, so Pocket QA controls the funds independently (§5.2). Avoid "controlled" multisigs, which Squads advises against for most uses (OBSERVED [S33]).

## 4. Costs and fees

### 4.1 Facts

- **Fees:** 5,000 lamports per signature, plus a priority fee. Transactions are capped at 1,232 bytes (OBSERVED [S29][S30]).
- **Rent today:** (128 + bytes) × 5,080 lamports, on both mainnet and devnet.
  - A 165-byte token account costs 1,488,440 lamports, or 0.00148844 SOL (OBSERVED [S1]).
  - Older tools still quote 0.00203928 SOL (INTERPRETATION).
- **SIMD-0437:** cuts the rate from 6,960 to 696 lamports per byte in five steps. Steps 3–5 are expected with Agave 4.4 in November 2026 (OBSERVED [S31]).
  - A token account would then cost 203,928 lamports (INTERPRETATION).
  - Read rent at runtime rather than hard-coding it.
- **Rent is a refundable deposit** (OBSERVED [S31]). A tester can close their account and keep it, so fake wallets could farm rent that Pocket QA pays (INTERPRETATION).

### 4.2 Example: 10 × 1 USDC, 10% fee

Assumptions (HYPOTHESIS): $100/SOL; a ~200-byte study account; ~100-byte submission accounts. Rent figures come from [S1].

| Item | Payer | SOL today | After SIMD-0437 |
|---|---|---|---|
| Study + vault | Builder | 0.0032 (refunded) | 0.0004 |
| 10 submission records | Service | 0.0116 (refunded) | 0.0016 |
| 10 new tester USDC accounts | Approval fee payer | 0.0149 (kept by testers) | 0.0020 |
| ~24 signatures | Builder / service | 0.0001 + priority | Same |

INTERPRETATION:
- **Today:** about 0.015 SOL is not refunded (≈ $1.50). That is 15% of the pool, and more than the 1 USDC fee.
- **After the rent cut:** about 0.002 SOL (≈ $0.21).
- **Streamflow, for comparison:** it would charge 1.6 SOL (OBSERVED rate [S14]).

### 4.3 Fee mechanics (INTERPRETATION)

- **Funding:** a single transaction deposits rewards plus fee, so the 11 USDC on screen is exactly what moves.
- **Pro-rata fee:** each payout sends the reward to the tester and that slot's fee share to the treasury. Unused fee is refunded together with unused rewards. A non-refundable upfront fee is simpler, but harder to defend.
- **Treasury:** a Squads vault fixed in Config, never a person's wallet. USDC has 6 decimals (OBSERVED [S1]), so fix the per-slot fee in base units at funding.
- **Network fees:**
  - The service pays all fees after funding.
  - For testers' account rent, absorb it on devnet. On mainnet, show a refundable "network costs" line per slot.
  - Kora covers fees (OBSERVED [S26]). Whether it can also cover rent is unverified.
- **Batching:** fees are charged per signature, so one builder signature over 10 approvals costs 10,000 lamports instead of 100,000 (from [S29]). Measure the batch size against the 1,232-byte limit, and use lookup tables for large batches.

## 5. Risks and compliance flags

### 5.1 Risks (INTERPRETATION unless marked)

- **Bugs:** handled by the audit, the invariants and the caps.
- **Keys:**
  - A stolen service key can't move funds.
  - A captured arbiter can only choose between the tester of record and the pool.
  - The upgrade key can rewrite the rules, so it needs a multisig, a time lock and monitoring.
- **Liveness:** permissionless timeouts must still release the vaults if Pocket QA disappears.
- **USDC freeze:** the USDC mint has a freeze authority (OBSERVED [S1]), so a frozen vault would trap funds.
- **Drifting parameters:** rent and Streamflow fees both changed in 2026 (OBSERVED [S31][S14][S15]).
- **Wallet display:** Solana Pay allows partly signed transactions (OBSERVED [S16]). How wallets display a fee paid by the service is unverified.
- **Laundering:** fake studies could disguise transfers between colluding wallets. That makes anti-collusion work compliance work too.

### 5.2 Questions for a lawyer (flags only)

**Not legal advice.** These are questions to ask counsel, not answers.

1. **FinCEN 2019 guidance.**
   - A multisig provider without "total independent control" of funds isn't a money transmitter; one with that control is (OBSERVED §4.2.2 [S37]).
   - Owners or operators of a DApp can be money transmitters (OBSERVED §4.4 [S37]).
   - Questions: Where do the custom program with an arbiter, a Squads 2-of-3 vault and a custodial API each fall? Do state money-transmitter or escrow laws apply? Do any exemptions fit?
2. **MiCA.** It lists custody and transfer of crypto-assets for clients as regulated services (OBSERVED [S38]). What applies to EU users, and to UK users?
3. **KYC/KYB and sanctions screening:** who, at what thresholds, in which countries?
4. **Tax:** reporting on rewards; VAT or GST on the fee.
5. **Terms:** refunds, disputes, the timeout default, contractor status, minimum age.
6. **Recordings:** consent, retention and cross-border storage, plus biometrics if World ID is used.
7. **Points:** they carry no cash value and imply no future token.

## 6. Anti-gaming

### 6.1 Identity and Sybil options

| Option | What it really is | Strength | Use |
|---|---|---|---|
| Email + phone code | Baseline. A phone lookup can flag virtual numbers (`nonFixedVoip`) (OBSERVED [S40]) | Weak | Everyone |
| Play Integrity | App and device integrity verdicts, including emulators. Needs Google Play distribution and services; not meant as the only defence (OBSERVED [S41]) | Medium | Play builds. Unverified on Seeker dApp Store installs |
| Seeker Genesis Token (SGT) | A Token-2022 NFT minted once per Seeker into the Seed Vault wallet. It moves only between the owner's own accounts. Verified with Sign-in-with-Solana plus RPC, recording the mint so it can't be reused (OBSERVED [S42][S43]). The mainnet group has 121,104 members; none exist on devnet (OBSERVED [S1]) | Proves device ownership, not personhood | Strong signal and Seeker badge, if approved (§7.1). No hardware-attestation API for third parties is documented; the device-model check is spoofable (OBSERVED [S42][S43]) |
| World ID | ZK proof of a unique human, via Orb, document or selfie credentials (OBSERVED [S44]). In 4.0, nullifiers are single-use and `session_id` is stable (OBSERVED [S45]). A Solana verifier exists on GitHub; deployment unverified [S46] | Strong (Orb) | Optional, checked on the backend |
| Solana Attestation Service | Credentials, schemas, and attestations with expiry and revocation (OBSERVED [S47]). On mainnet and devnet, upgradeable (OBSERVED [S1]). Partners include Civic, Solid, Solana.ID and Trusta Labs (OBSERVED [S48]). No audit found | As good as the issuer | Later, with vetted issuers |
| Civic Pass | Ended: CAPTCHA and ID verification on 2025-07-01; uniqueness and liveness on 2025-07-31 (OBSERVED [S49]) | — | Don't use |

**Proposal (INTERPRETATION)**
- **Tier 0, for everyone:** email, phone, wallet sign-in, integrity checks where available, rate limits.
- **Tier 1, for the leaderboard and badges beyond First Accepted Test:** add one strong signal (an SGT, World ID or a vetted attestation).
- **Payout KYC:** as counsel advises.

### 6.2 Duplicate recordings

- **Exact copies:** compare a SHA-256 hash per file (INTERPRETATION).
- **Near copies:**
  - Meta's PDQ makes 256-bit photo hashes.
  - TMK+PDQF compares whole videos (thresholds 0.7, or ≥ 0.9 for near-exact matches) but is weak on partial clips.
  - vPDQ counts shared similar frames (OBSERVED [S50]).
  - Chromaprint fingerprints audio (OBSERVED [S51]).
- **Caveat (INTERPRETATION):** recordings of the same app share screens, so matches are often legitimate. Treat hashes as review flags, alongside voice, touch timing, device metadata and how similar the feedback text is. Never auto-reject on a hash.

### 6.3 Collusion and rate limits

INTERPRETATION; the numbers are HYPOTHESIS.

**Signals**
- One builder dominates a tester's approvals, or the reverse.
- Reviews take less time than the recording.
- Approvals come in bursts, or everything is approved.
- Wallets share a funder or a sweep address, as in Arbitrum's sybil detection (OBSERVED [S52]).
- Accounts share devices, IP addresses or sign-up times.

**Responses**
- Points diminish for each builder–tester pair.
- Badges require several builders.
- Studies from new builders earn fewer points.
- New testers: at most 2 open submissions and 5 per day.
- New builders: 1 study, at most 20 slots.

### 6.4 When points count

INTERPRETATION; the numbers are HYPOTHESIS.

Points stay pending until all three of these hold:
- the payout is finalized;
- the dispute windows have closed;
- a 7-day fraud hold has passed.

Disputed work counts only if the admin rules for the tester. The ledger is append-only, with reversal entries. This fits the repo rule "No token farming" (OBSERVED [S57]).

### 6.5 Leaderboard and badges (HYPOTHESIS)

The product proposal ([`docs/design/reputation-layer.md`](../design/reputation-layer.md)) replaces these criteria for the product. Its §8 table lists where it differs and why, and its §9 asks Hamza about each difference.

**Reliability, R:** the 95% Wilson lower bound of accepted ÷ (accepted + upheld rejections + no-shows). The Wilson bound weighs quality against sample size (OBSERVED method [S53]).

**90-day score:** R × Σ (1, or 1.5 if marked helpful) ÷ k, where k is the acceptance's position among acceptances from the same builder.

**To be ranked:** Tier 1, at least 5 settled submissions, and at least 2 builders.

**Badges**

| Badge | Criteria |
|---|---|
| First Accepted Test | First settled acceptance |
| Reliable Tester | At least 10 settled, at least 3 builders, R ≥ 0.8 |
| Helpful Feedback | At least 5 helpful marks from at least 3 builders. Each builder may mark at most 30% of a study |
| Device Specialist | At least 8 acceptances on one device class, from at least 3 builders, with consistent device signals |

## 7. Open decisions for Hamza

1. **Devnet path:** the custom vault with Squads roles (recommended), or Squads only.
2. **Approver:** the builder's wallet (recommended), or a capped service key.
3. **Windows:** how long review, dispute and escalation last, and the timeout default (pay the tester, or return to the pool).
4. **Fee:** pro rata (recommended), or upfront and non-refundable.
5. **Network costs:** absorb them, or show them per slot.
6. **Mainnet:** the audit firm and budget, launch caps, and whether to stay upgradeable or go immutable.
7. **Identity:** which signals count, and whether they gate payouts or only the leaderboard.
8. **KYC/KYB:** thresholds and countries, after counsel.
9. **Points:** the hold period, reversals, decay and badge thresholds.

### 7.1 Connection to production gates A9 and B1

**Repo facts** (OBSERVED, `reshareai/pocket-qa` at `87e09d4` [S54][S55][S56][S57]):

- **A9 "Study funding without payments":** production builders "can't publish". The choice is:

  > "(a) allow unpaid, volunteer studies (reward 0, clearly labelled), or (b) no publishing until a payments decision. Payments, mainnet and billing stay unapproved either way."
- **B1** is blocked on A9.
- **B2 "Real compensation, payments, mainnet and custody":** "not authorised", requires "Separate explicit approval", and is marked prohibited.
- **The plan:**
  - The Money row bans "escrow, custody, smart contracts, real payouts, or paid services", with no devnet exception.
  - The out-of-scope list ("separate approval required") includes "real payouts and escrow" and "SGT/Seeker attestation".
  - The Web3 row says "No mainnet code path".
  - Chain features run only if the RPC genesis hash matches devnet.
- **CLAUDE.md:** "No mainnet escrow/real payouts/smart-contract custody or paid services without separate approval."

**How a pilot fits (INTERPRETATION)**

- **The pilot works with either A9 option.** In both cases, production pays no rewards: under (a) studies run at reward 0, and under (b) nothing publishes. Test credits stay off in production (the ledger's D3).
  - **Under (a):** production runs volunteer studies. The pilot runs only on non-production builds with test accounts, under the plan's "Devnet · no real value" label (OBSERVED [S56]). Volunteer studies also give early anti-gaming data (HYPOTHESIS).
  - **Under (b):** the pilot is the only place where rewarded studies run.
- **The plan as written still blocks the pilot.** The plan bans escrow and smart contracts outright.
- **CLAUDE.md may also apply to a devnet vault.** It lists "smart-contract custody" with no cluster attached, beside "mainnet escrow" and "real payouts". A devnet program that holds tokens is arguably smart-contract custody, so it may need that separate approval too, not just a plan amendment.
- **The SGT check reads mainnet.** That conflicts with "No mainnet code path" unless you approve a read-only exception.
- **The copy rules would change.** The plan's Copy row ("Reward if approved · Not guaranteed") and its banned-phrase linter, which blocks earnings promises in app copy and builder text, were written for test credits. A USDC pilot needs both revisited.

**Approvals, in order** (the order is INTERPRETATION; the quoted terms are yours):

1. **A9:** choose (a) or (b). No money is involved.
2. **Plan amendment:** devnet-only "escrow" and "smart contracts", with no real value. Add a recorded approval of devnet "smart-contract custody" (see above), and the copy-rule changes.
3. **Optional:** "SGT/Seeker attestation", as a read-only mainnet lookup.
4. **"Paid services" and "billing":** for counsel, the audit, and identity or RPC vendors. All of these come before any real money.
5. **B2:** "Real compensation, payments", "custody" and "mainnet", each recorded explicitly, after the §3.5 gates. Only then could B1 be revisited for paid studies.

## 8. Sources (all accessed 2026-10-05)

- **S1.** Solana public JSON-RPC, read-only: https://api.mainnet-beta.solana.com and https://api.devnet.solana.com.
  - `getMinimumBalanceForRentExemption` for 0, 100, 165, 200 and 300 bytes.
  - `getAccountInfo` for:
    - USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet) and `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (devnet);
    - Squads v4: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, its program data `Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n` (mainnet: no upgrade authority, deployed at slot 302,582,236; devnet: authority `HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`, deployed at slot 446,638,068), and its ProgramConfig `BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr`;
    - Smart Account: `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG`;
    - Streamflow: `strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m` (mainnet) and `HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ` (devnet);
    - SAS: `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`;
    - SGT group: `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te`.
- **S2.** Squads docs, *Security audits: v4*. https://docs.squads.so/main/security/security-audits/squads-protocol-v4
- **S3.** Squads v4 GitHub. https://github.com/Squads-Protocol/v4
- **S4.** Squads docs, *How secure is Squads*. https://docs.squads.so/main/security/how-secure-is-squads
- **S5.** Squads v4 source: `spending_limit.rs`, `multisig.rs`, `proposal.rs` and `program_config.rs`. https://github.com/Squads-Protocol/v4/tree/main/programs/squads_multisig_program/src/state
- **S6.** Squads v4 audit reports: Trail of Bits 2023-10-19; OtterSec 2023 and 2024; Neodyme 2024-12-10; Certora Nov 2024. https://github.com/Squads-Protocol/v4/tree/main/audits
- **S7.** OtterSec verify API. https://verify.osec.io/status/SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
- **S8.** Squads docs, *Create a Squad*. https://docs.squads.so/main/getting-started/create-a-squad
- **S9.** Squads docs, *Quickstart*. https://docs.squads.so/main/development/introduction/quickstart
- **S10.** Squads Smart Account Program:
  - https://github.com/Squads-Protocol/smart-account-program
  - https://squads.xyz/blog/squads-smart-account-program-live-on-mainnet
- **S11.** Smart Account audit reports: OtterSec 2025-05-21; Certora Jan 2025. https://github.com/Squads-Protocol/smart-account-program/tree/main/audits
- **S12.** Neodyme, *Security Report: Streamflow Protocol*, 2024-05-16. https://neodyme.io/reports/Streamflow-Protocol.pdf
- **S13.** Streamflow, *Has Streamflow been audited?* https://docs.streamflow.finance/en/articles/9338573-has-streamflow-been-audited
- **S14.** Streamflow fees and contract settings:
  - *Costs of using Streamflow* (2026-08-14): https://docs.streamflow.finance/en/articles/9675153-costs-of-using-streamflow
  - *Create a Vesting Contract*: https://docs.streamflow.finance/en/articles/9670413-create-a-vesting-contract
- **S15.** Streamflow JS SDK constants. https://raw.githubusercontent.com/streamflow-finance/js-sdk/master/packages/stream/solana/constants.ts
- **S16.** Solana Pay specification. https://docs.solanapay.com/spec
- **S17.** Solana docs, *Verify address*. https://solana.com/docs/payments/send-payments/verify-address
- **S18.** Solana docs, *Approve delegate*. https://solana.com/docs/tokens/basics/approve-delegate
- **S19.** Solana docs, *Token extensions*. https://solana.com/docs/tokens/extensions
- **S20.** Circle docs:
  - *Account types*: https://developers.circle.com/wallets/account-types
  - *Wallets on Solana*: https://developers.circle.com/wallets/wallets-on-solana
- **S21.** Bridge docs, *Custodial wallets*. https://apidocs.bridge.xyz/get-started/guides/wallets/overview
- **S22.** Stripe docs, *Stablecoin payouts for Connect*. https://docs.stripe.com/connect/stablecoin-payouts
- **S23.** Squads, Grid announcement. https://squads.xyz/blog/grid-a-stablecoin-api-for-accounts-payments-cards-and-yield
- **S24.** Gibwork, *Terms of Service* (2026-08-01). https://gib.work/terms
- **S25.** Superteam Earn FAQ. https://docs.superteam.fun/the-superteam-handbook/community/faqs/superteam-earn-faq
- **S26.** Solana Foundation, Kora. https://github.com/solana-foundation/kora
- **S27.** Circle, *USDC contract addresses*. https://developers.circle.com/stablecoins/usdc-contract-addresses
- **S28.** Circle faucet. https://faucet.circle.com/
- **S29.** Solana docs, *Fees*. https://solana.com/docs/core/fees
- **S30.** Solana docs, *Transactions*. https://solana.com/docs/core/transactions
- **S31.** Solana, *Reduced Rent* (SIMD-0437). https://solana.com/upgrades/reduced-rent
- **S32.** Solana docs, *Transaction confirmation and expiration*. https://solana.com/docs/advanced/confirmation
- **S33.** Squads docs, *Controlled multisigs*. https://docs.squads.so/main/development/reference/controlled-multisigs
- **S34.** Squads docs, *Cancel proposal*. https://docs.squads.so/main/development/typescript/instructions/cancel-proposal
- **S35.** Areta, *Solana audit subsidy*. https://areta.market/solana
- **S36.** Solana guide, *Verified builds*. https://solana.com/developers/guides/advanced/verified-builds
- **S37.** FinCEN, FIN-2019-G001 (2019-05-09). https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf
- **S38.** Regulation (EU) 2023/1114 (MiCA), Art. 3(1). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1114
- **S39.** AWS, MTurk `create_hit` (`AutoApprovalDelayInSeconds`). https://docs.aws.amazon.com/boto3/latest/reference/services/mturk/client/create_hit.html
- **S40.** Twilio, *Line Type Intelligence*. https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence
- **S41.** Android, *Play Integrity API overview*. https://developer.android.com/google/play/integrity/overview
- **S42.** Solana Mobile, *Seeker Genesis Token*. https://docs.solanamobile.com/marketing/engaging-seeker-users
- **S43.** Solana Mobile, *Detecting Seeker users*. https://docs.solanamobile.com/recipes/general/detecting-seeker-users
- **S44.** World ID overview. https://docs.world.org/world-id/overview
- **S45.** World ID 4.0 migration guide. https://docs.world.org/world-id/4-0-migration
- **S46.** Wormhole Labs, `solana-world-id-program`. https://github.com/wormholelabs-xyz/solana-world-id-program
- **S47.** Solana Attestation Service. https://github.com/solana-foundation/solana-attestation-service
- **S48.** Solana, *Introducing Solana Attestation Service*. https://solana.com/news/solana-attestation-service
- **S49.** Civic, *An update on Civic Pass* (2025-06-11). https://www.civic.com/blog/an-update-on-civic-pass
- **S50.** Meta ThreatExchange (PDQ, TMK+PDQF, vPDQ):
  - https://github.com/facebook/ThreatExchange
  - https://github.com/facebook/ThreatExchange/tree/main/tmk
- **S51.** AcoustID, *Chromaprint*. https://acoustid.org/chromaprint
- **S52.** Arbitrum Foundation, `sybil-detection`. https://github.com/ArbitrumFoundation/sybil-detection
- **S53.** Evan Miller, *How Not To Sort By Average Rating* (2009). https://www.evanmiller.org/how-not-to-sort-by-average-rating.html
- **S54.** `reshareai/pocket-qa` at `87e09d4`, `docs/production/parent-access-actions.md` (A9), read from the local clone with `git show`.
- **S55.** `reshareai/pocket-qa` at `87e09d4`, `docs/production/acceptance-ledger.md` (B1, B2).
- **S56.** `reshareai/pocket-qa` at `87e09d4`, `docs/plans/pocket-qa-execution-plan.md` (§2 Money, Web3 and Copy, §5.1, §5.3, Phase 6, §10).
- **S57.** `reshareai/pocket-qa` at `87e09d4`, `CLAUDE.md`.
