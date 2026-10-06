# pqa-be1: the devnet browser journey harness

The harness drives the devnet pilot in a browser with a Wallet Standard **test** wallet. It runs in two modes:

- **LOCAL:** the hosted app in `POCKETQA_ENV=devnet` through be3's test-only connectors seam (6bbc258). The connections go to the emulators, a fake S3 and `FakeDevnetChain`.
- **HOSTED:** be3's devnet preview on Solana devnet itself, once it exists.

## Ready (`apps/mobile/e2e-devnet/`, self-tested)

**`devnetWallet.ts`, the Wallet Standard test wallet:**
- **Features:** `signIn` (SIWS, with the domain checked against the page), `signMessage` and `signAndSendTransaction`.
- **The key** stays in the Node test process: a throwaway key for LOCAL runs, and the fixture loaded in memory for HOSTED runs. It is never printed and never sent to the page.
- **Guards:**
  - the chain must be `solana:devnet`;
  - only this wallet's account can sign;
  - an `approve` policy sees the programs a transaction calls.
- **Signing:** it signs exactly the fee-payer slot, then hands the signed bytes to `send`. In LOCAL runs, `send` goes to the fake chain; in HOSTED runs, to a devnet RPC.
- **Log:** every request is recorded as evidence.

**`fakeDevnetRpc.ts`, the fake devnet RPC:**
- **Routing:** it answers the client's **pinned** `https://api.devnet.solana.com` (`src/wallet/devnetRpc.ts`, CS3) through Playwright routing, with `getGenesisHash` and `getAccountInfo`. Any other method gets an error.
- **Vault transactions:** `vaultTransactionAccount()` encodes a Squads VaultTransaction from be3's `VaultTransfer` shape. The layout is pinned against `@sqds/multisig` in `packages/domain/src/vaultTransfer.test.ts`.

**`harness.spec.ts`:** the self-test runs on a route-only page and needs no app, emulators or build:
```
pnpm --filter @pocket-qa/mobile exec playwright test -c playwright.devnet.config.ts harness
```
The run on 2026-10-06 gave `1 passed`. The test checks that:
- the wallet signs funding and vote bytes, and the ed25519 signatures verify over the unchanged message;
- the wallet refuses mainnet, another account, the policy (a System program call) and a transaction where it isn't the fee payer;
- the fake RPC's VaultTransaction passes `verifyVaultTransfer`;
- no secret appears in the page.

## Blocked: what the LOCAL journey needs from the fake chain (asked via the lead)

1. **The transaction bytes.** `FakeDevnetChain.buildFundingTransfer` and `buildCosignerApprove` return base64 JSON, not Solana transactions. Since CS1, the client refuses anything that isn't the exact v0 template, so the journey would stop at "Not a valid devnet transaction".
   - **Proposal:** pure builders, shared by the future RPC `DevnetChain` and the fake, plus a contract test proving that their output passes `verifyFundingTx` and `verifyApprovalTx`.
2. **Accepting signed bytes.** `walletSend` must accept the wallet-signed v0 bytes: verify the signature, then apply the vote or credit the vault.
3. **Running it.** It needs the Firebase Auth and Firestore emulators plus a locally served web bundle. I'm waiting for the lead to confirm both under the build/command rules.

## The journey (LOCAL first, then HOSTED)

**Builder, on the allow-list, with the test wallet linked through SIWS:**
1. Create an escrow study on `squads_devnet`.
2. Request funding. Review the transfer: the amount, vault, source, reference and mint are checked in the bytes, and the devnet copy is shown.
3. Sign in the wallet. The funding reaches pending, then confirmed.

**Tester:** complete a test.

**Builder, after approving the test:**
1. Open the reward vote and review it. The amount, recipient and op id are checked on devnet, or "as described by Pocket QA" with the reason when the read fails.
2. Sign the vote. It is submitted.

**The study's leftover funds:** a refund vote, the same way.

**Negative paths:**
- a tampered plan: a System transfer, another vault, another amount;
- a vault transaction on chain that differs from the plan;
- a mainnet genesis on the RPC;
- the wallet on another account.

In every case, nothing is signed and the UI says why.
