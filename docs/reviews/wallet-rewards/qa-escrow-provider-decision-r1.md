# pqa-qa: independent challenge of the escrow provider decision, r1

**Candidate:** `0f28ed3` (`feat/wallet-rewards`), reviewed as `git diff 8849f8d..0f28ed3`. It's docs only:
- `docs/production/escrow-provider-decision.md`;
- `docs/reviews/wallet-rewards/provider-research-rpc.txt`;
- `provider-research/squads-config.mjs`.

**Reviewer rules held:**
- read-only;
- **public docs and public RPC reads only** (`getAccountInfo`, `getMinimumBalanceForRentExemption`), plus the public OtterSec verification registry and npm metadata;
- no keys, transactions, installs, or devnet or mainnet writes;
- no subagents and no advisor.

My checks ran 2026-10-05 UTC. The RPC script lived in my scratchpad, not the repo.

## 1. Source claims re-verified
| Claim in the doc | My independent check | Result |
|---|---|---|
| Squads v4 program `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, **immutable** | **Mainnet:** owned by the upgradeable loader; program-data `Fy3YMJCv…sh8n`, **authority null**; last deployed at slot 302,582,236 (read at slot 453,408,856) | ✅ **mainnet only** |
| "(mainnet and devnet)" under "Immutable" | **Devnet:** the same program id and program-data address, but **upgrade authority `HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`**, a System-owned account, so a **single key**. Last deployed at **devnet slot 446,638,068** (read at slot 507,538,513) | ❌ **The devnet deployment is upgradeable** (P2-1) |
| Audits: Trail of Bits, Neodyme, OtterSec, Certora | osec.io/audits lists "July 12, 2023 squads v4 Solana 2L 3I" and "April 24, 2024 Squads Solana 2M 1L 4I" | ✅ (OtterSec entries confirmed; the other firms are as listed by Squads) |
| The audited commit matches the deployment: "claimed, not independently verified here" | **The public OtterSec verification registry** (`verify.osec.io/status/SQDS4ep65…`) returns `"is_verified": false`, `"message": "On chain program not verified"`, `"commit": "3742e5521a3e…"`, `"is_frozen": true`, `on_chain_hash d4866083…` | ⚠️ The doc is honest that it didn't run a build. But the **public registry says not verified**, and records a commit **different** from the README's "final and fully audited" `64af7330…`. That isn't stated, and the matrix overclaims (P2-2) |
| License AGPL-3.0; a licence check is needed | The repo is AGPL-3.0 (as stated). **The official SDK `@sqds/multisig` 2.1.4 is MIT** (npm) | ✅, plus a useful nuance (P3-3) |
| Creation fee 0 lamports; changeable config authority | ProgramConfig `BSTq9w3k…cNZr` (owner Squads) gives `multisig_creation_fee = 0` on **mainnet and devnet**. Config authority `8xgjL6yq…YFT` is **System-owned (a single key)**. Its powers, from `program_config.rs`, are only `program_config_set_authority`, `…_set_multisig_creation_fee` and `…_set_treasury`, with **no power over existing multisigs or vaults** | ✅ (add the single-key fact and the limited powers) |
| Streamflow: upgradeable, single System-owned key; no program source; fees unknown | **Mainnet:** authority `5u7o2WGg…g2n7`, System-owned, `executable false`, data length 0. Last deployed at slot **449,063,805**. (The devnet authority differs: `3APYkb9W…eHue`) | ✅ |
| Circle custody, licensing and pricing | circle.com/wallets: 0–1,000 free; 1,001–5,000 at $0.050 each; … over 250,001 at $0.020 each; Gas Station "5% fee on that cost"; Solana listed | ✅ |
| Classic Token program's only audit is Kudelski 2020; Anchor OtterSec 2024-10-18 | anza-xyz/security-audits: Kudelski 2020-09-21 is the **only** classic Token audit (17 for Token-2022). osec.io: "October 18, 2024 Anchor Solana 1H 4I" | ✅ |
| Rent: 1,488,440 lamports for 165 bytes on both clusters | `getMinimumBalanceForRentExemption(165)` gives **1,488,440** on mainnet-beta and devnet | ✅ |
| Evidence slots | The doc's table cites "slot 449063805" for the Squads immutability read. **That is Streamflow's last-deploy slot.** The ProgramConfig read is "slot 453407990" in the doc but 453,408,589 in the evidence file | ⚠️ (P3-1) |

## 2. Is the recommendation safe and honest?
- **"No single party can move funds"** holds only under **all** of these conditions. The doc names the first two:
  1. an **autonomous** config (`config_authority` default);
  2. an arbiter **independent** of Pocket QA;
  3. **no spending limit** granted to any member (see below);
  4. Pocket QA holding **exactly one** member key;
  5. the **mainnet** program (immutable). On devnet a single external key can replace the program code (P2-1).
- **Squads-specific points the doc should state** (verified in the source):
  - **Spending limits are single-party spending.** `spending_limit_use` lets one member move funds within a limit without other approvals.
    - In an autonomous multisig, creating one needs a config transaction approved at the threshold. `multisig_add_spending_limit` requires the `config_authority`; autonomous multisigs "should use `config_transaction_create` instead".
    - The doc's matrix suggests "Spending limits could narrow it". That would reintroduce single-party spending, so it should be **prohibited** for escrow vaults, or explicitly accepted as a trade-off.
  - **Two colluding members can reconfigure.** A threshold-approved config transaction can change members, the threshold or the time lock (and makes older transactions stale via `stale_transaction_index`). The builder plus Pocket QA, or Pocket QA plus a non-independent arbiter, can therefore move funds or replace the arbiter. That's inherent to 2-of-3 and should be named.
  - **Permissions** (`Initiate=1`, `Vote=2`, `Execute=4`): define per member, for example builder Vote, arbiter Vote, Pocket QA Initiate+Vote+Execute. Any member with Execute can run an approved transaction.
  - **`rent_collector`** decides who reclaims the rent of executed or cancelled transaction accounts; choose it, for example the payer of the rent. `None` disables reclaiming.
  - **`time_lock`** (seconds between approval and execution) can give the third party a review window. Optional, but it's a design choice.
  - **The tester isn't a member.** An approved reward's protection rests on two of the three signers honouring the app's decision. That's worth one sentence in the trust-model UI copy.
- **Overclaims:** the matrix row "Audited code that moves funds: Supported (4 firms + formal verification)" and §1 "immutable on mainnet" with "(mainnet and devnet)" in the table. See P2-1 and P2-2.

## 3. §6 and §8
- **§6 decisions** are minimal and exact, except decision 2 (devnet pilot). It should state that the **devnet Squads program is single-key upgradeable** and may not match mainnet code, so Hamza approves the pilot knowing it doesn't test the immutable mainnet program.
  - Design parameters (permissions, `rent_collector`, `time_lock`, no spending limits) are engineering choices, not Hamza decisions. Record them in the ADR.
- **§8 "safe now without approval":** three of the four items are fine (offline adapter skeleton, server policy check, UI wording behind a disabled flag; the SDK is MIT and a pinned, reviewed dependency is reasonable).
  - **"A live quote reader for rent and the Squads creation fee (public, read-only RPC)"** isn't safe-without-approval as written. ADR 0007 and the approved slice's config refuse any provider RPC, mint or network in this phase (my matrix row A2; test A2). A live mainnet or devnet RPC read from the app would change that fail-closed posture (P2-3).

## Findings

### P2-1: the devnet Squads deployment is upgradeable by a single key, but the doc presents the program as immutable for "mainnet and devnet"
- **Where:** `docs/production/escrow-provider-decision.md`, §2 A rows "Program" and "Upgradeability", plus §6.2.
- **Evidence:** devnet program-data `Fy3YMJCv…sh8n` has authority `HM5y4mz3…dtvK`, System-owned (a single key); last deployed at devnet slot 446,638,068.
- **Impact:** the recommended devnet custody pilot would hold test funds in code that a third party can replace at any time, and that may differ from the audited or mainnet build. Pilot results wouldn't carry over to mainnet.
- **Fix:**
  - state that it's immutable **on mainnet only**, and that devnet is upgradeable with that authority;
  - add the caveat to decision 2;
  - optionally record the devnet versus mainnet program-data hashes, so a pilot runs on a known build.

### P2-2: the audit-to-deployment match is publicly reported as not verified, and the matrix overclaims
- **Where:** §2 A "Audit ↔ deployment match", and §4 "Audited code that moves funds: Supported".
- **Evidence:** `verify.osec.io/status/SQDS4ep65…` returns `is_verified: false` ("On chain program not verified"), records commit `3742e552…` against the README's `64af7330…`, and `on_chain_hash d4866083…`.
- **Fix:**
  - say "audited **source**; the deployed bytecode isn't verified against the audited commit (the public OtterSec registry reports *not verified*, and records a different commit)";
  - change the matrix cell to "audited source; deployment match unverified";
  - make a successful verifiable-build match (or an equivalent hash comparison) a **gate before mainnet use**.

### P2-3: §8 lists a live RPC quote reader as safe without approval, which contradicts the current fail-closed config
- **Where:** §8, the fourth bullet.
- **Fix:** keep it offline (fixtures and a parameterised calculator), or move "live RPC reads from the app" to "Needs Hamza's approval", alongside the ADR 0007 config change it requires.

### P3-1: evidence slot numbers don't match
- §2 A cites "slot 449063805" for the Squads mainnet read, but that's Streamflow's last-deploy slot. The ProgramConfig slot (453407990) differs from the evidence file (453,408,589). Align the doc with `provider-research-rpc.txt`.

### P3-2: add the Squads design constraints to the recommendation
These are listed in §2 above:
- no spending limits;
- per-member permissions;
- `rent_collector`;
- an optional `time_lock`;
- two-of-three reconfiguration power;
- the tester not being a member;
- the config authority being a single key with fee, treasury and authority powers only.

### P3-3: license nuance
- The program source is AGPL-3.0. The official SDK `@sqds/multisig` (2.1.4) is **MIT**.
- Calling the deployed program through the SDK doesn't involve distributing modified AGPL code. Keep the counsel check for any fork or redistribution of the program.

## Verdict
The research is broad, mostly accurate and honest about what wasn't verified:
- no turnkey audited escrow;
- Streamflow, Circle and the custom-program trade-offs;
- rent;
- the 0 creation fee;
- the audit dates.

Squads v4 as a 2-of-3 autonomous vault is a reasonable recommendation for Hamza to consider.

**Three P2 accuracy issues must be fixed before this document is used for a decision:**
- the devnet upgradeability;
- the unverified audit-to-deployment match, with the overclaim in the matrix;
- the §8 live RPC reader.

This review approves nothing for activation. The provider gates B-2 and B-3 remain.

VERDICT: CHANGES_REQUIRED
