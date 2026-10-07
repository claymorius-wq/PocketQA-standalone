# pqa-qa: verification plan for pqa-codex-web (wX:p8, Codex): real-UI frontend devnet payout journey

## Binding and baseline (05:32:48Z)
- **Server:** the PID file `~/.local/share/pocketqa/e28/server.pid` = **50736** = the listener on 127.0.0.1:8697.
- **Served entry** `entry-6eda6939…`, bytes sha256 `bfabf8c8…` = **the 4ee4603 artifact** (= my export). Health ok.
- **Chain baseline** (finalized; `qa-codex-baseline.jsonl`):
  - platform 4 742 343 080 lamports, last signature `pxJqRhrn` at 05:15:38Z;
  - builder 6XoD… 49 865 000 lamports, last signature `4S7T7kZ3` at 05:15:02Z;
  - tester fixture 6xof… 0 lamports;
  - arbiter 9 995 000.
- Anything signed after these is attributable to the new run.

## How I'll classify the wallet (honestly; no equivalence by default)
| Class | What it is | What it proves |
|---|---|---|
| **INJECTED** | A Wallet Standard object put in the page by the harness (Playwright `addInitScript`, a dev-tools snippet, or similar), signing with a fixture key in the test process | The app's Wallet Standard calls and checks. **NOT** wallet compatibility. |
| **REAL EXTENSION** | An installed, store-distributed extension (Phantom/Solflare/Backpack: name + version recorded, devnet mode) where a **human or the extension's own UI** approves each signature | Wallet compatibility for that extension/version. |
| **REAL EXTENSION, imported fixture key** | As above, but holding a fixture secret | Compatibility is evidenced. **Custody is not changed** (same single custodian; Hamza's decision required before importing). |

**Required evidence to claim REAL EXTENSION:**
- the extension's ID + version from the browser's extension page;
- a screenshot of **the extension's own approval popup** per signature (funding, reward vote, refund vote, fee vote), showing devnet;
- the console/network log with **no** injected-wallet marker;
- the signing address = the linked wallet.

**On chain I verify:** the fee payer and signer of each builder transaction = that wallet. I can't tell injected from extension on chain (same ed25519), **so the classification rests on the browser evidence, never on the chain.**

## Other conditions
- **Domain.** A real browser on `http://127.0.0.1:8697` gives a SIWS domain ≠ page and a CORS origin that isn't allowed. **If the lead chooses option 1** (`--host-resolver-rules` + a self-signed TLS terminator + `--ignore-certificate-errors`), every row must be labelled **"test-only hostname mapping with TLS errors ignored: NOT the hosted deployment"**. The extension may also flag the domain. Record that.
- **The tester's payout address.** tester-1 is linked to the **keyless** `Bp8jEPny…`, so rewards to it are unspendable (as in Pixel 7). Prefer a tester whose wallet key is kept. Any link change needs the lead's/parent's explicit OK (the parent's rule).
- **Bounds:** ≤ 3 test USDC funded and ≤ 0.05 SOL platform spend per run. Stop on the first failure, read the chain first, and never retry blindly. **No deletions** (the halt).
- **For each run, send:** study id, multisig, vault ATA, destinations, op ids, signature prefixes + sha256, the wallet class + extension name/version, and screenshots. I'll run `qa-study-readback.mts` + `qa-e28-readback.py` (with op ids) and the platform/builder signature windows from the baseline above.

## Codex run #1: stopped before any chain action (lead), and re-bind
- **Confirmed on chain:** the last platform signature is still `pxJqRhrn` (05:15:38Z) and the last builder signature still `4S7T7kZ3` (05:15:02Z). **No new signatures** since the baseline, so run #1 did nothing on chain.
- **The cause** (lead): tester-2 was already linked to `56vXnb5p…`, E-29's keyless tester-B throwaway. No link was changed.
- **The lead provisioned a NEW synthetic tester-3** (`pqa-e2e-devnet-tester-3@example.test`, verified via an admin link, allow-listed, devnet account `3da83bd1…`). A first link of the tester fixture `6xof…` (key kept, recoverable) is planned for it.
  - **No existing link changes**, which is consistent with the parent's rule.
  - **Recorded:** another synthetic Auth user in production Firebase Auth (project-global; the same authorisation as N-E28-1).
- **Re-bind:** the PID file = the listener = **57713**. Same entry `6eda6939…`, bytes `bfabf8c8…` (= 4ee4603). Health ok.
- **Expected wallet class for run #2: INJECTED** (an in-page Wallet Standard object signing with the fixture key). **No wallet-compatibility claim** (L-12 stays BLOCKED).

## Codex run #2: funding segment read back (public RPC, finalized)
**Wallet class: INJECTED** (in-page Wallet Standard, builder fixture). **Domain: test-only hostname mapping, TLS errors ignored.**
- **Study** `i6e0cf44e…` ("Codex devnet journey muxosrqy").
- **Builder since the baseline: exactly 1 signature**, `4TyVGsoCE6…`. sha256 = `96f59695…15f1` (**match**). err none; **payer and only signer = the builder fixture `6XoDNc`**.
  - **One** spl-token `transferChecked`: `3pns…` → vault **`GJNTrTkt…`**, mint `4zMM`, **1 100 000** units.
  - The funding **reference `BtytnEsm…` is among the transaction's accounts** (Solana Pay style).
- **Platform since the baseline: exactly 2:**
  - `2qu4RajUH8` at 05:48:43: MultisigCreateV2 (1 833 720);
  - `DmDrBveyxW` at 05:48:46: vault ATA create (1 493 440).
  - Both err none.
- **The vault is bound:** `GJNTrTkt…` = ATA(vaultPda(multisig **`DGLfjk17…`**, 0)). Balance **1 100 000**.
- **Funding = PASS on chain.** The rest of the run (tester join → payout → close) is awaited for the full readback.

## Codex run #2 COMPLETE: independent readback = PASS
- **Study** `i6e0cf44e…`, multisig `DGLfjk17…`, vault `GJNTrTkt…` (bound = ATA(vaultPda)). Run data written by me (`qa-run-codex-i6e0cf44.json`, op ids from the chain and recomputed).
- **`qa-study-readback.mts` (window from the baseline at 05:32:48Z): RESULT ok:**
  - multisig pinned 2-of-3, `transactionIndex` 3;
  - **#1 reward** 500 000 → `3zQEpQEm…` = **ATA(tester fixture `6xofkwsc…`)**, memo `67c7b2e4…`;
  - **#2 fee** 50 000 → the fee wallet (**op id recomputed**);
  - **#3 refund** 550 000 → the builder (**op id recomputed**);
  - each **Executed** [builder, platform] (builder first), `executeOk 1 / executeFailed 0 / platformVotes 1 / builderVotes 1 / failedTxs 0`. **#4 absent. Vault 0.**
  - **Platform:** 14 signatures (MultisigCreateV2 1, ATA 1, VaultTransactionCreate 3, ProposalCreate 3, ProposalApprove 3, VaultTransactionExecute 3), **0 outside, 0 failed**, net **18 810 040**.
- **`qa-e28-readback.py` (with op ids): ok true** (26 transactions). Each row exactly once with its memo:

  | Row | Amount | Destination | Transaction |
  |---|---|---|---|
  | funding | 1 100 000 | vault | `4TyVGsoCE6` |
  | reward | 500 000 | `3zQE` | `5Dkq6PBF` |
  | refund | 550 000 | `3pns` | `5V6ghfr1` |
  | fee | 50 000 | `52wW` | `2M6raggF` |

  Program data unchanged.
- **Builder since the baseline: exactly 4 signatures, each matched by prefix AND sha256:**
  - funding `4TyVGsoCE6` (96f59695);
  - reward vote `7NEZFVwB8U` (106d1174);
  - refund vote `4XqoL9utcT` (073a398e);
  - fee vote `4kvkSSMRjh` (686ed714).
  - All err none.
  - **The deliberate reward-vote cancel left no transaction on chain.**
- **The report is honest** (`codex-web-e2e/report.md`): "Wallet class: `Pocket QA Test Wallet (devnet): injected by Playwright, not an extension`; `NOT extension compatibility`". Target: "test-only hostname mapping, TLS errors ignored, NOT the hosted deployment".
  - Note: its line 55 mentions local TLS private keys from early attempts, covered by a `.gitignore` and "must not be committed". These are self-signed **test** TLS keys, not wallet keys. They must stay uncommitted, and under the halt they aren't deleted.

## Verdict
**Codex frontend payout journey = PASS** (devnet, real browser UI on the 4ee4603 artifact): funding → tester join/upload/submit → reward vote (one cancel, then sign) → payout settled once → close → refund + fee votes → each settled once → vault 0. **Independently verified on chain.**

**Classification:**
- **INJECTED** wallet (Playwright) + a **test-only hostname mapping with TLS errors ignored**, so this is **not** the hosted deployment and **not** real-extension compatibility.
- **L-12 (real wallet extension / MWA) stays BLOCKED.** Custody is unchanged (single custodian; L-13).
