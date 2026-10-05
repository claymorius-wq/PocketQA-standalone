# Escrow provider decision: Solana USDC study payouts, refunds and arbitration

**Status:** research and recommendation for Hamza. **Nothing is selected, created, deployed or funded.** Revised after pqa-qa r1 (CHANGES_REQUIRED: devnet upgradeability, unverified deployment match, live RPC reader).

**How this was researched:**
- read-only, on 2026-10-04 and 05 (UTC);
- primary sources and public Solana RPC reads only (`getAccountInfo`, `getMinimumBalanceForRentExemption`);
- no installs, wallets, keys, transactions, devnet deployment or paid services.

**Context:** ADR 0007 and pqa-qa architecture review r1 (gates B-2 and B-3). The local simulated slice is approved (pqa-qa r2–r4).

**What we need:**
1. A builder funds a study in USDC.
2. Each approved test releases one exact reward to a wallet that becomes known only at consent.
3. Unused funds are refunded to the funder.
4. A defined arbiter can decide disputes.
5. No single party, including Pocket QA, can move funds alone.
6. No release without approval (no optimistic or auto-release).

## 1. Short answer
- **No turnkey, audited, maintained escrow provider was found** for approval-gated work payouts with arbitration on Solana. Solana Pay, Covenant and the hackathon "milestone escrow" repositories don't qualify (see §3). This document doesn't select an unsafe contract to fill that gap.
- **The safest verified building block is Squads Protocol v4**, used as a per-study custody vault:
  - its **source** is audited by four firms, with formal verification;
  - the **mainnet** program is immutable;
  - it is open source and maintained.
  
  **But:** the deployed mainnet bytecode is **not verified** against the audited commit (§2 A), and the **devnet** copy can be upgraded by a single key.
  
  Pocket QA's existing escrow state machine decides outcomes, and the vault's members co-sign them. This gives real multi-party custody without new on-chain code. No single key can move funds, but only under the conditions in §5: an autonomous config, an independent arbiter, no spending limits, Pocket QA holding one key, and the mainnet program.
- **A custom escrow program built on audited primitives** (Anchor and SPL Token) could enforce the exact rules on-chain. But the program itself would be **unaudited** until an external audit is commissioned. That is a larger cost and risk; keep it as a later option.
- **Circle developer-controlled wallets** are a working, priced, regulated-provider route, but they are **custodial for Pocket QA**: it holds the means to move funds, and Circle states that licensing may apply. It isn't escrow.

## 2. Candidates and evidence
Every row was checked at the source on the dates shown; "Unknown" means not verified.

### A. Squads Protocol v4: audited multisig used as the study vault
| Item | Finding | Source |
|---|---|---|
| Program | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`: the same id on mainnet and devnet | github.com/Squads-Protocol/v4 README (2026-10-04) |
| **Upgradeability** | **Mainnet: immutable.** Program-data `Fy3YMJCv…sh8n` has `authority: None`; last deployed at slot 302,582,236. **Devnet: upgradeable by a single System-owned key `HM5y4mz3…dtvK`**; last deployed at devnet slot 446,638,068. The devnet code can change at any time and may differ from mainnet | public RPC reads in `docs/reviews/wallet-rewards/provider-research-rpc.txt` (2026-10-04); also found by pqa-qa r1 |
| Audits | Trail of Bits (2023); Neodyme (2023, 2024); OtterSec (2023, 2024); Certora security review and formal verification (Oct 2023, Dec 2023). The reports are in the repo's `audits/` folder | docs.squads.so/main/security/security-audits/squads-protocol-v4; osec.io/audits lists "July 12, 2023 squads v4" and "April 24, 2024 Squads" (2026-10-04) |
| **Audit ↔ deployment match** | **Not verified.** The README marks commit `64af7330…` as "final and fully audited". The public OtterSec verification registry reports the mainnet program as `is_verified: false` ("On chain program not verified"), records commit `3742e552…` (a different commit), `is_frozen: true` and on-chain hash `d4866083…`. **The audits cover source, not the deployed bytecode.** A verified build match (or an equivalent hash comparison) is a **gate before any mainnet use** | github.com/Squads-Protocol/v4; https://verify.osec.io/status/SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf (2026-10-04); pqa-qa r1 |
| License | The program source is AGPL-3.0 (with Apache-2.0/MIT exceptions for some utility files). The official SDK `@sqds/multisig` (2.1.4) is **MIT** (per pqa-qa r1, npm metadata). Calling the deployed program through the SDK doesn't redistribute modified AGPL code; any fork or redistribution of the program needs a counsel check | GitHub repo metadata (2026-10-04); npm |
| Maintained | Last commit 2026-08-20; not archived | GitHub API (2026-10-04) |
| Arbitrary recipients | Yes: vault transactions execute arbitrary instructions, including SPL Token transfers to any account | repo README ("vault transactions", "spending limits") |
| Governance | `config_authority` default means an **autonomous** multisig (config changes go through member voting). A set key means a **controlled** multisig (that key alone changes members and threshold). Escrow use **must be autonomous** | docs.squads.so/main/development/reference/accounts (2026-10-04) |
| Time locks | "A transaction will be frozen for a certain period of time after reaching the ready to execute threshold" | docs.squads.so/main/development/reference/time-locks |
| Spending limits | A pre-approved allowance for a member: one token type, an optional period, a maximum amount, and allowlisted destinations ("multiple addresses can be added"). Who must approve creating one is **not stated** in the source read | squads.xyz/blog/spending-limits (2026-10-04) |
| Protocol fee | `ProgramConfig.multisigCreationFee` is **0 lamports** on mainnet (config `BSTq9w3k…cNZr`, slot 453,408,589 in the evidence file) and on devnet (pqa-qa r1). The config authority `8xgjL6yq…YFT` is a **single System-owned key**. Its only powers are setting the authority, the creation fee and the treasury; it has **no power over existing multisigs or vaults** (`program_config.rs`, pqa-qa r1). The fee can change, so it is re-checked before any approved pilot | `program_config.rs` plus public RPC reads |
| Onboarding | None: it is a public program | — |

### B. A custom escrow program on audited primitives (Anchor plus the classic SPL Token program)
| Item | Finding | Source |
|---|---|---|
| Primitives | **Classic SPL Token:** one listed external audit, Kudelski, 2020-09-21. Many audits exist for Token-2022, which we don't use for USDC. **Anchor:** OtterSec audit, 2024-10-18 | github.com/anza-xyz/security-audits; osec.io/audits (2026-10-04) |
| The program itself | **Unaudited.** It would be written by us. Audited dependencies don't make it audited | — |
| Fit | The best: it can enforce on-chain that release goes only to the frozen destination, for the exact reserved amount; that refunds go only to the funder; and that there is one payout PDA per participation | ADR 0007 §3 |
| Upgrade authority | Must be our choice, ideally a Squads multisig, then frozen once audited. Not yet decided | — |
| Cost | The external audit price is **Unknown**: quotes are needed. Development effort is also not quoted here | — |

### C. Streamflow: audited token distribution (vesting and payouts)
| Item | Finding | Source |
|---|---|---|
| Program | `strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m` | Streamflow SDK docs and search (2026-10-04) |
| **Upgradeability** | **Upgradeable**, by authority `5u7o2WGg…2n7`, a System-owned account, so a **single key**, not a multisig PDA | mainnet `getAccountInfo` (2026-10-04) |
| Audits | Its FAQ: "audited on Solana by OPCODES and FYEO"; `rust-sdk/audit_reports/protocol_audit_001.pdf` exists. Whether the audits match the deployed program is **Unknown** | streamflow.finance/faqs; GitHub (2026-10-04) |
| Source | The JS SDK is GPL-3.0. The `rust-sdk` repo has `programs/{example, streamflow-sdk}`. **I found no public source of the deployed protocol program** | GitHub (2026-10-04) |
| Fees | Its FAQ says "fixed, network-denominated costs" and points to the docs. The exact amount is **Unknown** (a third-party "1%" claim is not used) | streamflow.finance/faqs |
| Fit | **Poor.** Release is time-based (streams and vesting, with optional cancel, which returns unvested funds to the sender), not builder approval. A stream created only after approval adds nothing over a direct transfer | — |

### D. Circle developer-controlled wallets: a regulated provider, custodial for Pocket QA
| Item | Finding | Source |
|---|---|---|
| Custody | "You control wallet creation, transaction execution, and signing through Circle APIs." The developer holds an entity secret that "Circle never stores" | developers.circle.com/wallets/dev-controlled (2026-10-04) |
| Regulation | "Regulatory licensing requirements may apply in your jurisdiction" when holding assets for end users. The developer enforces limits, KYC and fraud checks | same |
| Solana | Supported (the All-Included tier lists Solana) | circle.com/wallets (2026-10-04) |
| Pricing | Per monthly active wallet: 0–1,000 free each month; 1,001–5,000 at $0.050 per wallet; down to $0.020 above 250,001. Gas Station adds 5% on sponsored gas | circle.com/wallets (2026-10-04) |
| Fit | It works technically (send USDC anywhere), but it is **custodial for Pocket QA**: no escrow guarantee, and legal and licensing exposure | — |

## 3. Excluded, with evidence
- **Solana Pay:** the spec has "no provisions for escrow functionality, conditional transaction release, or dispute resolution"; it is a payment-request format only (docs.solanapay.com/spec, verified by pqa-qa). It is still usable later as the funding request format.
- **Covenant** (github.com/wienerlabs/covenant): devnet only; external audit "planned"; optimistic acceptance (auto-release after a 24 h window unless challenged). That differs from explicit builder approval.
- **Hackathon milestone escrows:** for example Escrowl, MicroEscrow, Stillpaid and GigSafe on GitHub. The ones that state it are unaudited (Escrowl: "has NOT been externally audited"). Stillpaid auto-pays on client silence, which contradicts "no auto-pay of unreviewed work".

## 4. Matrix
| Need | A: Squads v4 vault | B: custom program | C: Streamflow | D: Circle dev wallets |
|---|---|---|---|---|
| Audited code that moves funds | **Audited source; deployed mainnet bytecode not verified** (registry: not verified, different commit). A verified match is a mainnet gate | **Unsupported** until we commission an audit | Claimed audits; deployment match Unknown | Provider-operated; not an on-chain program |
| Immutable or controlled upgrades | Mainnet immutable; **devnet single-key upgradeable** | Our choice (Unknown) | Single-key upgradeable | n/a (provider) |
| Release only on approval | Supported, through signatures (threshold) | Supported, enforced on-chain | **Unsupported** (time-based) | Supported, through our backend (custodial) |
| Exact amount and frozen destination enforced **on-chain** | **Unsupported** (enforced by the signers and our backend, not code). Spending limits must **not** be used: they are single-party spending | Supported | Partly (recipient fixed per stream) | Unsupported (backend only) |
| Recipient unknown until consent | Supported | Supported | Supported (stream created later) | Supported |
| Partial payouts and refunds | Supported (one vault transaction each) | Supported | Partly (cancel returns unvested) | Supported |
| Arbitration | Supported (independent arbiter member) | Supported (arbiter role in program) | Unsupported | Our backend only |
| No single party moves funds | Supported **only under all §5 conditions** (autonomous, independent arbiter, no spending limits, one Pocket QA key, mainnet program) | Supported, if designed so | Unsupported for sender cancel | **Unsupported** (Pocket QA controls) |
| Protocol fee | 0 lamports today (changeable config) | None | Unknown | Per-wallet pricing (above) |
| Onboarding | None | None | None | Circle account; licensing may apply |
| Source and license | AGPL-3.0 | Ours | Program source not found | Proprietary service |

## 5. Recommendation
**A Squads v4 per-study vault**, as the provider behind our existing `SettlementProvider` interface. It moves to **devnet only after approval**, and to mainnet only after a separate approval and a legal and custody assessment.

**Conditions for "no single party can move funds"** (all of them are required):
1. an autonomous config (`config_authority` default);
2. an arbiter independent of Pocket QA;
3. **no spending limits** on the vault: `spending_limit_use` lets one member spend within a limit without other approvals;
4. Pocket QA holding exactly one member key;
5. the immutable **mainnet** program. On devnet a single external key can replace the code.

**Residual risks:**
- **Two members can reconfigure.** With 2-of-3, any two members (for example the builder and Pocket QA, or Pocket QA and an arbiter who isn't independent) can approve a config transaction that changes the members, threshold or time lock, or simply move funds. That is inherent to the design.
- **The tester isn't a member.** An approved reward is protected only by two of the three signers honouring the app's decision, and the trust-model copy says so.

**Design parameters** (engineering choices, recorded in ADR 0007 when built):
- **Permissions:** the builder and the arbiter have Vote; Pocket QA has Initiate, Vote and Execute. Any member with Execute can run an approved transaction.
- **`rent_collector`:** set to whoever paid the rent, so the rent of executed or cancelled transaction accounts can be reclaimed. `None` disables reclaiming.
- **`time_lock`:** optional, giving the third party a review window between approval and execution.

**Shape:**
- **Vault:** one autonomous multisig per study (`config_authority` default), with three members:
  1. the builder's wallet;
  2. a dedicated Pocket QA release key;
  3. an arbiter key held by someone independent of Pocket QA.
  
  Threshold 2.
- **Funding:** the builder sends USDC to the vault's token account. Our verifier reads it from the finalized balance deltas (already built: `observeTokenTransfer`).
- **Payout:**
  1. On approval, Pocket QA proposes a vault transaction: an SPL transfer of the exact reward to the tester's frozen wallet's token account.
  2. The builder co-signs it in their wallet. Their signature is the approval.
  3. In a dispute, the arbiter co-signs instead.
  
  The server refuses to propose anything except the frozen amount and destination. Execution is confirmed at `finalized`.
- **Refund:** Pocket QA proposes the transfer to the funding wallet and the builder co-signs. If the builder is unresponsive after closing, the arbiter co-signs.
- **What this does not give:** on-chain enforcement of amount and destination. It relies on two of the three signers. That residual trust is stated plainly in the UI ("two of: you, Pocket QA, the arbiter must sign every movement"), and the word "trustless" is never used.

**Why not B now:** an unaudited custom program holding user funds is the riskiest option, and its audit cost is unknown. Revisit B only if per-approval builder signatures prove unworkable or on-chain rule enforcement becomes a requirement, with a funded external audit.

**Why not C or D:** C doesn't model approval-gated release. D is custodial with licensing exposure; choose it only if Hamza prefers a regulated custodial operator over multi-party custody.

## 6. Hamza's decisions (exact and minimal)
1. **Approach:** A (Squads vault, recommended), B (custom program plus an audit), D (Circle, custodial), or none for now.
2. **Devnet custody pilot:** approve a devnet-only pilot that creates Squads multisigs holding **devnet test USDC**. CLAUDE.md requires separate approval for smart-contract custody. Yes or no.
   - **Caveat:** the devnet Squads program can be upgraded by a single third-party key (`HM5y4mz3…dtvK`) and may not match the mainnet build. A pilot tests the integration and the flows, **not** the immutable mainnet program.
   - The pilot records the devnet program-data hash it ran against.
3. **Arbiter:** who holds the third key (you personally, a named independent party, or another). If Pocket QA holds two keys, the model becomes custodial.
4. **Release key:** approve creating a dedicated devnet Pocket QA release keypair, stored outside the repo with mode 0600 (or on a hardware wallet). Never a personal wallet.
5. **Who pays SOL costs:**
   - the vault token account rent (rent-exempt minimum for a 165-byte account: **1,488,440 lamports**, read live on 2026-10-04 on mainnet and devnet);
   - the multisig and proposal accounts' rent: **Unknown** until measured on devnet;
   - the tester's token-account creation when missing;
   - signature fees (5,000 lamports per signature base, plus any priority fee).
   
   Options: the builder (added to the quote) or Pocket QA.
6. **Platform fee:** the rate, and the fee recipient address (today 10% is illustrative only).
7. **Before any mainnet use:** whether a legal and custody assessment is required. Recommended: yes.

## 7. Budget impact (no invented quotes)
- **A:** the protocol creation fee is 0 lamports today and can change; rent and network fees are paid in SOL (see decision 5). The license review and legal assessment have **Unknown** costs.
- **B:** the external audit cost is **Unknown** (get quotes), plus a re-audit after any change. The upgrade-authority custody also has to be decided.
- **C:** fees **Unknown**; not recommended.
- **D:** Circle wallet pricing as listed; compliance and licensing costs **Unknown**.

## 8. What can be built safely now, without approval
This is local code with no keys, network writes or custody. It stays disabled behind `POCKETQA_SETTLEMENT`.
- A `squads` adapter skeleton that implements `SettlementProvider` in pure code. It derives the multisig and vault addresses and builds the funding expectation, the payout transfer and the refund transfer, so all can be **unit-tested offline** against the recorded program id and fixtures. Adding the official `@sqds/multisig` SDK would be a pinned dependency with a lockfile review; it needs no secrets.
- A server policy check: a proposal is built only for the frozen destination's token account and the exact reserved amount (tests).
- The UI wording of the trust model for the "two of three signers" design, and the builder's per-approval co-sign flow behind a disabled flag.
- An **offline** cost calculator: parameterised rent and fee inputs with fixtures, shown as "estimate" and never promised. **No RPC.** ADR 0007's config refuses every provider network setting in this phase.

**Needs Hamza's approval:** live RPC reads from the app (they need an ADR 0007 config change), anything in §6, any keypair, any devnet multisig, any devnet or mainnet transfer, any Circle account, any audit spend, and any mainnet or real-fund activity.

## Sources (accessed 2026-10-04 UTC)
- Squads v4 security audits: https://docs.squads.so/main/security/security-audits/squads-protocol-v4
- Squads v4 repository and README: https://github.com/Squads-Protocol/v4
- Squads ProgramConfig struct: https://github.com/Squads-Protocol/v4/blob/main/programs/squads_multisig_program/src/state/program_config.rs
- OtterSec verification registry (Squads v4): https://verify.osec.io/status/SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
- Squads accounts reference: https://docs.squads.so/main/development/reference/accounts
- Squads time-locks: https://docs.squads.so/main/development/reference/time-locks
- Squads spending limits: https://squads.xyz/blog/spending-limits
- OtterSec audits list: https://osec.io/audits
- Anza security audits (SPL and Token-2022): https://github.com/anza-xyz/security-audits
- Streamflow FAQ: https://streamflow.finance/faqs
- Streamflow SDK repos: https://github.com/streamflow-finance/js-sdk, https://github.com/streamflow-finance/rust-sdk
- Circle dev-controlled wallets: https://developers.circle.com/wallets/dev-controlled
- Circle Wallets pricing: https://www.circle.com/wallets
- Solana fees: https://solana.com/docs/core/fees
- Solana Pay spec: https://docs.solanapay.com/spec
- Covenant: https://github.com/wienerlabs/covenant
- Escrowl (example of an unaudited hackathon escrow): https://github.com/garba-the-analyst/Escrowl
- Public mainnet and devnet RPC reads (getAccountInfo, getMinimumBalanceForRentExemption): https://api.mainnet-beta.solana.com, https://api.devnet.solana.com. Commands and output: `docs/reviews/wallet-rewards/provider-research-rpc.txt` (the ProgramConfig reader is `docs/reviews/wallet-rewards/provider-research/squads-config.mjs`)
