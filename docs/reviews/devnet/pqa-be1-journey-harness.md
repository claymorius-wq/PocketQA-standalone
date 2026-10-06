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

## The LOCAL journey: run on 2026-10-06, 3 passed

**How it runs:**
- **The backend** is `e2e-devnet/local-devnet-server.mts`, a separate ESM process: `apps/api` is ESM and Playwright's test loader is not. It binds `127.0.0.1:8693` and refuses 8787. It serves the real hosted app in `POCKETQA_ENV=devnet` through be3's test-only connectors, plus `/__harness/` routes for the test wallet's send and for reading vault accounts.
- **The browser** sees one virtual https origin, `https://pocketqa-devnet.example`, through Playwright routing (`e2e-devnet/localDevnet.ts`):
  - static files come from the web export, and `/api` is forwarded to the backend;
  - Firebase Auth calls go to the Auth emulator;
  - the client's pinned devnet RPC goes to the fake chain;
  - everything else is aborted, and each test asserts that list is empty.
- **The fake chain:** the run needs feat/devnet-builders (the real-bytes `walletSend` and `vaultTransactionAccount`). Until be3 merges it, I run the journey over an uncommitted `git merge --no-commit feat/devnet-builders` and abort the merge afterwards.

**The commands** (the emulators run on my ports from `firebase.emu-be1.json`):
```
EXPO_PUBLIC_API_URL=/api EXPO_PUBLIC_POCKETQA_ENV=devnet npx expo export --platform web --output-dir <scratch>/devnet-web --clear
firebase emulators:exec --only firestore,auth --project demo-pocketqa --config firebase.emu-be1.json \
  "cd apps/mobile && PQA_WEB_DIR=<scratch>/devnet-web PQA_EVIDENCE_DIR=<scratch>/devnet-journey npx playwright test -c playwright.devnet.config.ts journey"
```

**The result** on the committed code (19c9ebd, over feat/devnet-builders 7f0148a):
```
  ✓  1 e2e-devnet/journey.spec.ts:106:5 › 1 · funding: a tampered plan is refused in the browser; the real transfer is reviewed, signed in the wallet and verified (5.5s)
  ✓  2 e2e-devnet/journey.spec.ts:148:5 › 2 · reward vote: the payment is read on devnet and checked; the builder signs; the platform completes the 2-of-3 (3.6s)
  ✓  3 e2e-devnet/journey.spec.ts:180:5 › 3 · refund vote at close: reviewed against the study’s refund, signed, completed (2.8s)
  3 passed (14.6s)
```

**What the run asserts:**
- **Funding:**
  - A plan whose bytes are a System transfer (the QA P2-CS1 repro) is refused in the browser with "Nothing was signed", and the wallet receives no request.
  - On the real plan, the amount, vault, source, reference and mint are checked in the bytes. The wallet signs only a Token-program transaction, the fake chain verifies the signature, and the server observes the funding: "Funded on devnet".
- **Reward vote:** the vault transaction is read on (fake) devnet, and the amount, recipient and op id are shown as checked, with nothing left "described" (CS3). The wallet signs only a Squads transaction, and the chain then shows `cosigner_approve`, `approve_platform` and `execute`.
- **Refund vote at close:** it is checked against the study's refund and the funding wallet, signed, and completed ("finalized on devnet, no value").

**Evidence:** `docs/reviews/devnet/evidence/pqa-be1-local-journey/01…07.png`.

**Found by the run, and fixed:** at phone width, the multisig, proposal, recipient, op id and signer values ran off the signing card, so a value the builder must verify before signing was cut off. Fix 684eea4 (`VERIFY_VALUE`) is test first; screenshots 02, 04 and 06 show the wrapped values.

**Not covered:**
- the hosted run on Solana devnet itself (it waits for be3's preview, the CSP origin and the fixture keys);
- the Android MWA path (the Seeker lane).

## Re-run on a committed SHA (QA G-W2), 2026-10-07

- **What ran:** b5fa752 (feat/devnet-client after merging feat/devnet-adapter 2180b1e, which includes the builders 7f0148a), with **no temporary merge**: clean tree, same commands as above.
- **Result:** 3 passed (1 · funding 6.6 s, 2 · reward vote 4.5 s, 3 · refund vote at close 4.8 s). The evidence is in `docs/reviews/devnet/evidence/pqa-be1-local-journey-b5fa752/` (screenshots plus `run.txt`).
- **Gates on b5fa752:**
  - mobile jest: 71 suites, 1465 tests; mobile tsc and eslint: clean;
  - domain: 18 files, 301 tests;
  - api unit: 49 files, 779 tests (1 file and 2 tests skipped); api tsc and eslint: clean;
  - api emulator suite: 33 files, 683 tests (1 file and 7 tests skipped), on the be1 ports.
