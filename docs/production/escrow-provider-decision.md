# Escrow provider decision: Solana USDC study payouts, refunds and arbitration

**Status:** research and recommendation for Hamza. **Nothing is selected, created, deployed or funded.**

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
  - audited by four firms, with formal verification;
  - immutable on mainnet;
  - open source and maintained.
  
  Pocket QA's existing escrow state machine decides outcomes, and the vault's members co-sign them. This gives real multi-party custody without new on-chain code. It also leaves no single key able to move funds, provided the arbiter is genuinely independent of Pocket QA.
- **A custom escrow program built on audited primitives** (Anchor and SPL Token) could enforce the exact rules on-chain. But the program itself would be **unaudited** until an external audit is commissioned. That is a larger cost and risk; keep it as a later option.
- **Circle developer-controlled wallets** are a working, priced, regulated-provider route, but they are **custodial for Pocket QA**: it holds the means to move funds, and Circle states that licensing may apply. It isn't escrow.

## 2. Candidates and evidence
Every row was checked at the source on the dates shown; "Unknown" means not verified.

### A. Squads Protocol v4: audited multisig used as the study vault
| Item | Finding | Source |
|---|---|---|
| Program | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (mainnet and devnet) | github.com/Squads-Protocol/v4 README (2026-10-04) |
| **Upgradeability** | **Immutable.** The upgradeable loader's program-data account `Fy3YMJCv…sh8n` has **no upgrade authority** (`authority: None`) | mainnet `getAccountInfo`, slot 449063805, 2026-10-04 |
| Audits | Trail of Bits (2023); Neodyme (2023, 2024); OtterSec (2023, 2024); Certora security review and formal verification (Oct 2023, Dec 2023). The reports are in the repo's `audits/` folder | docs.squads.so/main/security/security-audits/squads-protocol-v4; osec.io/audits lists "July 12, 2023 squads v4" and "April 24, 2024 Squads" (2026-10-04) |
| **Audit ↔ deployment match** | The README marks commit `64af7330…` as "final and fully audited" and says deployments can be checked with the Ellipsis Labs verifiable-build tool. **I did not run a verifiable build:** the match is claimed, not independently verified here | github.com/Squads-Protocol/v4 (2026-10-04) |
| License | AGPL-3.0, with Apache-2.0/MIT exceptions for some utility files. **This needs a licence check** before Pocket QA ships modified Squads code. Using the deployed program through its SDK is a separate question, to confirm with counsel | GitHub repo metadata (2026-10-04) |
| Maintained | Last commit 2026-08-20; not archived | GitHub API (2026-10-04) |
| Arbitrary recipients | Yes: vault transactions execute arbitrary instructions, including SPL Token transfers to any account | repo README ("vault transactions", "spending limits") |
| Governance | `config_authority` default means an **autonomous** multisig (config changes go through member voting). A set key means a **controlled** multisig (that key alone changes members and threshold). Escrow use **must be autonomous** | docs.squads.so/main/development/reference/accounts (2026-10-04) |
| Time locks | "A transaction will be frozen for a certain period of time after reaching the ready to execute threshold" | docs.squads.so/main/development/reference/time-locks |
| Spending limits | A pre-approved allowance for a member: one token type, an optional period, a maximum amount, and allowlisted destinations ("multiple addresses can be added"). Who must approve creating one is **not stated** in the source read | squads.xyz/blog/spending-limits (2026-10-04) |
| Protocol fee | `ProgramConfig.multisigCreationFee` is **0 lamports** (config `BSTq9w3k…cNZr`, authority `8xgjL6yq…YFT`, slot 453407990, 2026-10-04). The config authority can change it, so read it live at quote time | the `program_config.rs` struct plus a mainnet read |
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
| Audited code that moves funds | Supported (4 firms plus formal verification) | **Unsupported** until we commission an audit | Supported (claimed; deployment match Unknown) | Provider-operated; not an on-chain program |
| Immutable or controlled upgrades | Supported (immutable) | Our choice (Unknown) | Single-key upgradeable | n/a (provider) |
| Release only on approval | Supported, through signatures (threshold) | Supported, enforced on-chain | **Unsupported** (time-based) | Supported, through our backend (custodial) |
| Exact amount and frozen destination enforced **on-chain** | **Unsupported** (enforced by the signers and our backend, not code). Spending limits could narrow it; Unknown | Supported | Partly (recipient fixed per stream) | Unsupported (backend only) |
| Recipient unknown until consent | Supported | Supported | Supported (stream created later) | Supported |
| Partial payouts and refunds | Supported (one vault transaction each) | Supported | Partly (cancel returns unvested) | Supported |
| Arbitration | Supported (independent arbiter member) | Supported (arbiter role in program) | Unsupported | Our backend only |
| No single party moves funds | Supported, **if** the arbiter is independent and the multisig is autonomous | Supported, if designed so | Unsupported for sender cancel | **Unsupported** (Pocket QA controls) |
| Protocol fee | 0 lamports today (changeable config) | None | Unknown | Per-wallet pricing (above) |
| Onboarding | None | None | None | Circle account; licensing may apply |
| Source and license | AGPL-3.0 | Ours | Program source not found | Proprietary service |

## 5. Recommendation
**A Squads v4 per-study vault**, as the provider behind our existing `SettlementProvider` interface. It moves to **devnet only after approval**, and to mainnet only after a separate approval and a legal and custody assessment.

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
- A live quote reader for rent and the Squads creation fee (public, read-only RPC), shown as "estimate" and never promised.

**Needs Hamza's approval:** anything in §6, any keypair, any devnet multisig, any devnet or mainnet transfer, any Circle account, any audit spend, and any mainnet or real-fund activity.

## Sources (accessed 2026-10-04 UTC)
- Squads v4 security audits: https://docs.squads.so/main/security/security-audits/squads-protocol-v4
- Squads v4 repository and README: https://github.com/Squads-Protocol/v4
- Squads ProgramConfig struct: https://github.com/Squads-Protocol/v4/blob/main/programs/squads_multisig_program/src/state/program_config.rs
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
