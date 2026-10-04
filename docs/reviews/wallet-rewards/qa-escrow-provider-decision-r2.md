# pqa-qa: escrow provider decision, r2 (targeted re-review)

**Candidate:** `d260874` (`feat/wallet-rewards`), reviewed as `git diff 0f28ed3..d260874`. It's docs only, 3 files:
- `docs/production/escrow-provider-decision.md`;
- `provider-research-rpc.txt`;
- my r1 file copied into the branch, **byte-identical** to mine (`diff` empty).

**Rules held:**
- read-only;
- no new network calls needed: the r1 on-chain facts stand, and the lead re-ran them in the evidence file;
- no keys, transactions or installs;
- no subagents and no advisor.

My detached checkout was clean afterwards. `check-secrets`: 820 files, no findings.

## r1 findings
| r1 | Now in the doc | Status |
|---|---|---|
| **P2-1:** devnet upgradeable | §2 A Upgradeability: "**Mainnet: immutable** … last deployed at slot 302,582,236. **Devnet: upgradeable by a single System-owned key `HM5y4mz3…dtvK`**; last deployed at devnet slot 446,638,068. The devnet code can change at any time and may differ from mainnet". Program row: "the same id on mainnet and devnet", with immutability no longer claimed for both. Matrix: "Mainnet immutable; **devnet single-key upgradeable**". §6 decision 2 caveat: a pilot "tests the integration and the flows, **not** the immutable mainnet program", and the pilot records the devnet program-data hash it ran against. §1 reworded | **fixed** (matches my r1 reads) |
| **P2-2:** deployment match overclaimed | §2 A: "**Not verified** … `is_verified: false` … commit `3742e552…` (a different commit), `is_frozen: true` … **The audits cover source, not the deployed bytecode.** A verified build match … is a **gate**" before mainnet. Matrix: "**Audited source; deployed mainnet bytecode not verified** … A verified match is a mainnet gate". §1 says the same. The evidence file now includes the registry response | **fixed** |
| **P2-3:** live RPC reader in §8 | §8 now has "an **offline** cost calculator … **No RPC.** ADR 0007's config refuses every provider network setting in this phase". "Live RPC reads from the app (they need an ADR 0007 config change)" moved under "Needs Hamza's approval" | **fixed** |
| **P3-1:** slots | The Squads read now cites slot 302,582,236, the last mainnet deploy. The ProgramConfig read is slot 453,408,589, matching the evidence file. The wrong 449,063,805 and 453,407,990 are gone (a search finds 0 leftovers) | **fixed** |
| **P3-2:** Squads constraints | §5 lists all five conditions for "no single party can move funds", including **no spending limits** ("single-party spending") and the mainnet program. Residual risks: two-of-three reconfiguration; the tester isn't a member. Design parameters: permissions, `rent_collector`, optional `time_lock`. The matrix wording "Spending limits must **not** be used" replaces "could narrow it" | **fixed** |
| **P3-3:** license | "The program source is AGPL-3.0 … The official SDK `@sqds/multisig` (2.1.4) is **MIT** … any fork or redistribution of the program needs a counsel check". The ProgramConfig authority is described as a single key with authority, fee and treasury powers only | **fixed** |

No overclaims remain in the passages I checked:
- "Squads … immutable" now says mainnet only;
- "audited" now says source only;
- "no single party" now carries all five conditions;
- §8 contains nothing that needs approval.

## Verdict
Every r1 finding is fixed accurately, and the document is now an honest basis for Hamza's provider decision. **This approves the decision document only.** Nothing is activated: provider gates B-2 and B-3, and every item in §6 and in "Needs Hamza's approval", remain.

VERDICT: APPROVE
