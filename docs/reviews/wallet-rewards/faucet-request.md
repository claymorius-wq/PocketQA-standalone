# Squads devnet pilot: faucet request (public addresses only)

> **Status (2026-10-05):** pqa-qa approved the revised OFFLINE candidate `dc76870` (pilot offline r2), which lifts the parent's hold. **The live run is now blocked only on these faucet assets.** A read-only re-check after the approval still shows 0 lamports and no devnet USDC account. `devnet-pilot-receipt.*` is the superseded BLOCKED dry run at `5d5d431`.

**Scope:** ADR 0007 §10, Hamza's approval of the bounded devnet pilot.

**These are test-only keys** generated for this pilot on 2026-10-05. The key files sit outside Git in `~/.config/pocketqa-devnet-pilot/` (directory 0700, files 0600). **No key material is in this file or anywhere in the repo.**

**Address check:** each address below was re-derived from its key file (ed25519 public key from the 32-byte seed) and also matches the public half stored in the file. The checker prints only addresses and match results:

```
dir mode 700
builder   6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn file-mode 600 derived-match true embedded-match true
pocketqa  DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS file-mode 600 derived-match true embedded-match true
arbiter   5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm file-mode 600 derived-match true embedded-match true
tester    6xofkwscPCYuKszrmNrx7EGvQ1xhTKu7CgTohfuRmPBs file-mode 600 derived-match true embedded-match true
outsider  4VDsYTwUARKro6xPPdvGUxW63UyTmhnZNVSAaJ5hz1S6 file-mode 600 derived-match true embedded-match true
```

## What is needed (valueless devnet assets only)
| Role | Public address | Asset and network | Amount | Official faucet |
|---|---|---|---|---|
| **Pocket QA release key**, which pays every fee and rent in the pilot | `DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS` | **SOL, Solana devnet** | 1 SOL is plenty (0.5 SOL is enough) | https://faucet.solana.com (select devnet) |
| **Builder** (the study funder; simulated test role) | `6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn` | **USDC, Solana Devnet**: Circle mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | one drip (20 test USDC; Circle allows 20 per 2 hours per address) | https://faucet.circle.com (network: Solana Devnet) |

The arbiter, tester and outsider need no assets. The Pocket QA key pays their transaction fees, and the tester's token account is created by the payout.

## What was attempted (2026-10-05 UTC)
1. **Public RPC faucet** (`requestAirdrop` on `https://api.devnet.solana.com`, after confirming the devnet genesis hash):
   - **Pocket QA, 1 SOL:** JSON-RPC error `-32603 "Internal error"`.
   - **Builder, arbiter and tester, 1 SOL each:** HTTP-style error `429` "You've either reached your airdrop limit today or the airdrop faucet has run dry. Please visit https://faucet.solana.com for alternate sources…".
   - **One later retry for Pocket QA, 0.5 SOL:** `429` again.
   - **Not retried further.** **No request succeeded:** the finalized balance of every address is 0 lamports.
2. **Web faucets** (faucet.solana.com, faucet.circle.com): **not attempted. The browser was unavailable**: the Claude-in-Chrome extension reported "Browser extension is not connected". This was **not** a permission denial. Both pages are web forms with CAPTCHA protection, and **no CAPTCHA would be solved or bypassed**.
3. **Circle programmatic faucet** (`/v1/faucet/drips`): **not attempted.** It needs a Circle account with verification, which means new cloud credentials, and those aren't authorised.

## Minimum human action
On the two official faucet pages above, paste the address shown for each row, choose the devnet network, and submit, completing any CAPTCHA yourself. Nothing else is needed: no keys and no personal or mainnet assets.

The pilot runner checks the finalized balances itself before it starts, and refuses any mint other than Circle's devnet USDC.

## Runner readiness (re-checked 2026-10-05, after commit 5d5d431)
- **Minimum the runner checks before sending anything:** at least **0.2 devnet SOL** on Pocket QA and **3.4 devnet test USDC** on the builder (3.30 to fund the study plus 0.01 for the unmatched-deposit check). One drip from each faucet covers this.
- **Balances re-read (read-only RPC, no faucet call):** Pocket QA has 0 lamports. The builder has 0 lamports and no devnet USDC token account. **Still blocked.**
- **Dry run with the keys:** `test-live/squads-devnet.pilot.live.test.ts` stopped at its balance check with `BLOCKED: … Nothing was sent.` Its receipt (`devnet-pilot-receipt.md`, outcome *failed: BLOCKED*) records only the genesis check and the Squads program-data state:
  - program-data account `Fy3YMJ…sh8n`, last deploy slot 446638068, upgrade authority `HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`;
  - account sha256 `5c866bde…0d37`.
- **Once funded, the run is one command:**
  ```
  cd apps/api && POCKETQA_LIVE_SQUADS_DEVNET=1 POCKETQA_LIVE_SQUADS_KEYS_DIR=~/.config/pocketqa-devnet-pilot npx vitest run --config vitest.live.config.ts test-live/squads-devnet.pilot.live.test.ts
  ```
  It overwrites the receipt with every signature, slot, finalized status and explorer link, plus balances, costs and the program-data state before and after.
