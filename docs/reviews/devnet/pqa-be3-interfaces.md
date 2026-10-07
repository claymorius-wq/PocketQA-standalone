# pqa-be3: devnet adapter interfaces for pqa-be2's harness

Model claude-opus-5-5. Branch `feat/devnet-adapter` (base `dc5da90` plus the contract amendments r1 at `81e4dc7`). This answers the five questions in `devnet-races/docs/reviews/devnet/pqa-be2-races-harness-design.md`. The shapes below are binding. If one changes, this file changes in the same commit and the lead is told.

**Exported types (flag 4):** `DevnetChain`, `DevnetStep`, `DevnetStepInput`, `PreparedTx`, `UnsignedTx`, `BuilderWallet`, `DevnetLimits` and `DEFAULT_DEVNET_LIMITS` are in `apps/api/src/settlement/squads/devnetTypes.ts`, so an independent fake implements the real interface.

## 1. Adapter factory and dependencies
```ts
// apps/api/src/settlement/squads/devnet.ts
export function devnetSettlement(deps: {
  repo: Repos;               // namespaced Firestore repos (§4); escrow repo holds receipts and leases
  chain: DevnetChain;        // RpcDevnetChain (live) or FakeDevnetChain (test/fakeDevnetChain.ts)
  now: () => number;         // injectable clock: leases, spend windows, receipts
  limits: DevnetLimits;      // CH-D1 spend caps
}): DevnetSquadsSettlement;  // implements SettlementProvider, plus the builder-approval methods (§2)
```
- **`DevnetChain` = the read half of today's `SquadsChain`** (`genesisHash`, `mintInfo`, `programExecutable`, `memoProgramExecutable`, `programDataHash`, `getMultisig`, `getVaultTransfer`, `getProposal`, `tokenBalance`, `findExecuteSignature`, `getParsedTransaction`, `signatureStatus`), **plus a split send:**
  - `prepare(input: DevnetStepInput): Promise<PreparedTx>`: builds and signs with the **platform signer only**, without broadcasting. `PreparedTx = { step, messageB64, signature, wireB64, lastValidBlockHeight, estLamports }`.
  - `broadcast(p: PreparedTx): Promise<void>`: sends the exact bytes. Resending the same bytes is idempotent: same signature.
  - `blockHeight(): Promise<number>`: the finalized block height.
  - `buildCosignerApprove(multisig, index, member): Promise<UnsignedTx>`: unsigned, with the member as fee payer, for a wallet or the arbiter CLI to sign.
  - `buildFundingTransfer({ from, vaultAta, amount, reference }): Promise<UnsignedTx>`: the builder-signed funding transfer (CH-D3).
  - `roles: { platform: string; arbiter: string }`: public keys only. **There is no builder key on the server;** the builder member is the study's linked wallet.
- **`DevnetStep`:** `multisig_create`, `vault_ata_create`, `dest_ata_create`, `vault_tx_create`, `proposal_create`, `approve_platform`, `execute`. Only the platform signs these. There is **no** server-side builder or arbiter approve.
- **No timers:** nothing awaits finality in-process. Each run does at most one send per operation, and the next run reads the status.

## 2. The builder's approval (the signer seam)
1. **The approval transaction:** `GET /settlements/:id/approval` (study builder only) returns
   `{ transactionB64, multisig, txIndex, opId, kind, amountUnits, destination, copy }`.
   - `transactionB64` is an **unsigned** v0 transaction: one Squads `proposal_approve` for `(multisig, txIndex)`, with the builder's linked wallet as member **and** fee payer.
   - It is bound to that exact index and op id (CH-D3). A request for a settlement whose receipt has no proposal yet is a `409`.
2. **The harness signs** with a `BuilderWallet = { publicKey: string; signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction> }`, driven by the `bui…` fixture.
   - The wallet broadcasts it, as Phantom or MWA would. On the fake chain, `FakeDevnetChain.submitSigned(wireB64)` applies the approve for the signing member.
3. **The harness posts** `POST /settlements/:id/approval { signature }`.
   - The server **never trusts the signature**. It reads the proposal and requires `approved ∋ builder wallet`, then runs a bounded settle slice: the platform approves and executes.
   - A bogus signature triggers only a chain read, and gets `409 COSIGNER_NOT_SEEN`.
- **The arbiter (dispute overturn):** the same proposal waits for the arbiter's vote, given only by the operator CLI `apps/api/scripts/devnet-arbiter.ts` (key file path, chain-only inputs). There is no route.

## 3. Receipts and leases (Firestore, inside the namespace)
`squadsAttempts/{settlementId}`. This is the receipt, written **before** the first broadcast:
```ts
{
  settlement_id, kind: 'payout'|'refund'|'fee', study_id, participation_id: string|null,
  op_id,                          // §3.1
  multisig, vault_authority, vault_ata, destination, destination_ata,
  amount_units: number,           // the ledger integer
  cosigner: 'builder'|'arbiter', cosigner_key: string,
  tx_index: number|null,          // claimed index; guard squadsTx/{multisig}:{index} (R2 row 33)
  steps: { [step in DevnetStep]?: {
    message_b64: string,          // CH-D5: serialised message + signature stored before broadcast
    signature: string,
    last_valid_block_height: number,
    status: 'prepared'|'sent'|'finalized'|'failed',
    slot: number|null, fee_lamports: number|null,
  } },
  state: 'claimed'|'created'|'proposed'|'awaiting_cosigner'|'approved'|'executed'|'finalized'|'refused',
  lease: { holder: string, fence: number, until: number } | null,
  created_at: number, updated_at: number,
}
```
- **Retry order (CH-D5):**
  1. Check each recorded step's signature with `signatureStatus`.
  2. Then look the operation up on chain by op id (the memo in the vault transaction, via `findByOperation`).
  3. **Adopt** whatever is found.
- **Resend rules:**
  - A step that is `prepared` or `sent`, not found, with its blockhash still valid, is rebroadcast with **the same bytes**.
  - **Rebuild on expiry, strictly (flag 3):** a step is rebuilt only when `lastValidBlockHeight < blockHeight()`, a strict `<`; at equality it can still land, so it isn't rebuilt. Even then it's rebuilt only after the chain read shows that step absent.
- **Fence before every broadcast (flag 1):** immediately before **every** `broadcast`, a Firestore transaction re-reads the receipt and refuses unless `lease.fence === myFence && lease.until > now()`. A holder whose lease was taken over therefore makes **zero** broadcasts, not just zero writes. The same transaction marks the step `sent` and reserves its spend, so a broadcast never happens without its receipt, fence and reservation in place.

### 3.1 Op id
Unchanged: `pqa-op1:` + `sha256(kind|studyId|participationId or '-')`, where `kind` is `payout`, `refund` or (new) `fee`. The memo in the vault transaction carries it.

### 3.2 Lease seam
- **Where:** `squadsAttempts/{settlementId}.lease`, in addition to the global `jobLeases/settle`.
- **Acquire:** a transaction that succeeds if `lease == null || lease.until <= now()`. It sets `{ holder, fence: prev+1, until: now()+DEVNET_OP_LEASE_MS }`, with `DEVNET_OP_LEASE_MS = 30_000`.
- **Write-back:** every write is a transaction that refuses unless `lease.fence === myFence` (`StaleFence`). A stale holder therefore writes nothing after a takeover.
- **Clock:** `now` comes from the factory; there is no wall clock inside.

## 4. Namespace, R2 prefix and routes
- **Firestore:**
  - `devnetFirestore(fs)` (in `src/firestore/namespace.ts`) is the **only** namespace function. It re-roots `collection(id)` and `doc(path)` under `pocketqaNamespaces/devnet/`.
  - `collectionGroup` throws.
  - `makeRepos` takes the namespaced instance when `POCKETQA_ENV=devnet`.
  - Every devnet document path starts with `pocketqaNamespaces/devnet/`.
  - Rules: the existing deny-all covers it; an emulator rules test pins it.
- **R2:**
  - In devnet mode, object keys are prefixed `devnet/` (`devnet/evidence/…`, `devnet/quarantine/…`).
  - The deletion worker's allow-list in devnet mode is `devnet/` only, so it can't touch `evidence/` or `retained-local-submissions/` (tested).
- **New contract routes** (for the E-25 coverage test). **Flag 5:** every one is a 404 for anyone but the study's builder, including another builder. `POST /settlements/:id/approval` is bound to the receipt's `(multisig, tx_index, op_id)`: the server reads only that proposal, so an approval on another index proves nothing and gets `409 COSIGNER_NOT_SEEN`. A request naming a different `txIndex` or `opId` is a `409 APPROVAL_MISMATCH`.

  | Name | Method and path | Auth / scope |
  |---|---|---|
  | `escrowFundingTransaction` | `GET /escrow/fundings/:id/transaction` | builder / study-owner |
  | `settlementApproval` | `GET /settlements/:id/approval` | builder / study-owner |
  | `submitSettlementApproval` | `POST /settlements/:id/approval` | builder / study-owner |

  - The existing `createEscrowFunding`, `submitFundingSignature` and the `/jobs/settle` cron are reused.
  - No arbiter route exists.
- **Settlement status gains `awaiting_approval`:** "Waiting for your approval in your wallet · devnet test USDC, no value · test keys · not independent custody".
- **Spend control (CH-D1):**
  - **Allow-list:** only accounts on `POCKETQA_DEVNET_ALLOWED_EMAILS` may start a server-signed operation. The list holds labelled synthetic `@example.test` addresses only; config refuses any other domain.
  - **Caps (flag 2):**
  - **Shape:** `DevnetLimits = { global: { lamports, usdcUnits }, perUser: { lamports, usdcUnits } }`. The default is `DEFAULT_DEVNET_LIMITS`, 0.05 SOL and 3 test USDC each.
  - **Reserved per transaction, idempotently:** the reservation is the guard doc `devnetSpendReservations/{signature}` → `{ uid, lamports, released }`, created in the same Firestore transaction that increments `devnetSpend/global` and `devnetSpend/user:{uid}` and runs the fence check before the broadcast.
    - Re-broadcasting the same bytes has the same signature, so the guard exists and nothing is reserved again.
  - **Rebuild:** a rebuilt transaction, whose predecessor expired unlanded (by the strict rule above), marks the old reservation `released`. The same transaction decrements the totals and reserves the new one, so there's no leak and no under-count.
  - **No overshoot:** both totals are read and written in that transaction, so N concurrent reservations serialise on `devnetSpend/global`. At the last unit of headroom exactly one succeeds; the rest get `409 DEVNET_SPEND_CAP` before signing.
  - **Lamports** are the step's `estLamports` (fee plus any rent it pays). **usdcUnits** are reserved when a funding request is opened, the only way funds enter.
  - **Rate limiting:** the shared rate limiter covers the three routes above and `createEscrowFunding`.

## 5. Live runs: getting the platform signer without printing it
- **On Vercel Preview:** `POCKETQA_DEVNET_PLATFORM_SIGNER` holds the 64-byte key as a JSON array. It's server-only, in `build.mjs`'s `SERVER_ONLY` scan list, set in the **Preview** environment only. Production config refuses it (CH-D4).
- **Locally (harness, E-28):** `POCKETQA_DEVNET_PLATFORM_SIGNER_FILE=<absolute path>`, pointing at the fixture's `pocketqa.json` inside `~/.config/pocketqa-devnet-pilot` (directory 0700, file 0600; both checked).
  - The loader `loadPlatformSigner(env)` returns a `Keypair` and logs nothing.
  - Its errors name the variable, never its value (tested with a canary key).
- **What is refused:** the builder and arbiter key files are never read by the server, and setting `POCKETQA_SETTLEMENT_PILOT_KEYS_DIR` in devnet mode is refused.
- **Never printed:** receipts and logs carry public keys, signatures (stored as prefix + sha256 in evidence) and slots only.

## 6. Route shapes for pqa-be1's client (in `packages/contracts`)
These are in the contract now, so the client can type against them:
- `DevnetFundingTransaction`
- `SettlementApproval`
- `SubmitSettlementApprovalBody`
- `SettlementApprovalResult`
- `DEVNET_COPY`
- `SettlementStatus` including `awaiting_approval`

Off the devnet deployment, every one of these routes returns `FEATURE_UNAVAILABLE` after the ownership check.

pqa-be1's points 1–4, confirmed or amended:
1. **`GET /escrow/fundings/:id/transaction`** returns `{ transactionB64, fundingId, studyId, reference, amountUnits, destination, mint, network: 'devnet', copy }`.
   - **Amended:** `reference` instead of `opId`. A funding isn't a Squads operation; it carries its Solana Pay reference.
   - `destination` is the study vault's token account, and the funding wallet is the fee payer.
   - After the wallet broadcasts it, the client calls the existing `POST /escrow/fundings/:id/signature`.
2. **`network: 'devnet'`** appears in both responses and in `SettlementApprovalResult`. The client refuses anything else.
3. **Field types:**
   - `amountUnits` is a JSON safe integer (`PositiveTokenUnits`, ≤ 10¹²).
   - `destination`, `mint` and `multisig` are base58 (`Base58Address`).
   - `kind` is one of `payout`, `refund` or `fee`.
   - `txIndex` is a positive integer, and `opId` matches `pqa-op1:` followed by 64 hex characters.
4. **`POST /settlements/:id/approval`:**
   - **Body:** `{ signature, txIndex, opId }`.
   - **Response:** `SettlementApprovalResult = { settlementId, kind, status, signature | null, network: 'devnet' }`. It's not `Payout`, because refunds and fees have no participation.

The platform signer's public key is pinned too (pqa-qa P2-DA1). `POCKETQA_DEVNET_PLATFORM_PUBKEY` is required, and the loaded key must equal it and differ from the arbiter, the fee wallet and the study's builder wallet. That's checked at startup, at multisig creation, and before every signature.

## 7. Landed for pqa-be2's stage 2 (types in `devnetTypes.ts`)
- **(b) The receipt** is `DevnetReceipt` (the `squadsAttempts/{settlementId}` doc), with `ReceiptStep` and `ReceiptState`, and the lease life is `DEVNET_OP_LEASE_MS = 30_000`. The receipt adds:
  - `uid`, the builder whose cap the payment counts against;
  - `reserved_lamports`;
  - `refusal`, which holds operator copy grounded in a fresh chain read.
- **(c) The namespace:** `devnetFirestore(fs)` in `src/firestore/namespace.ts`, with root `DEVNET_ROOT = 'pocketqaNamespaces/devnet'`.
  - `makeRepos({ kind: 'firestore', fs, namespace: 'devnet' })` applies it.
  - `r2Store(r2, { keyPrefix: 'devnet/' })` puts R2 objects under `devnet/`.
  - Tests: setting `PQA_TEST_NAMESPACE=devnet` with `PQA_TEST_BACKEND=firestore` runs any suite under both, and `t.fs` is namespaced too.
- **pqa-be2's P2 (liveness), adopted:** lamports are reserved for a **whole operation** when it starts, never per step.
  - **A payment** reserves `paymentLamports(destinationAtaMissing)` atomically when it claims its Squads index: vault tx, proposal, approve and execute, plus the destination token account's rent if it's missing, plus `RETRY_MARGIN_LAMPORTS`. If that doesn't fit, it's refused up front with `409 DEVNET_SPEND_CAP` and nothing signed.
  - **A study vault** reserves `VAULT_LAMPORTS` when its multisig is prepared.
  - **On finalize,** the reservation is trued up to what the landed transactions actually cost, and the remainder is released.
  - **Per-step estimates:** `STEP_LAMPORTS`.
  - **Replaces §4's per-transaction rule.** The idempotency key is now the operation, `devnetSpendReservations/{opKey}`, not the transaction signature. Re-broadcasts and rebuilds don't reserve again.
- **Still to land:** (a) the `devnetSettlement()` factory with the step machine.

## 8. Hosted wiring and the limits of the namespace (pqa-qa P1-NS1, P3)
- **The wiring:** `hostedBackends(config, env)` (in `src/hosted/app.ts`), used by `hostedDeps`, builds the repositories with `namespace: 'devnet'` and the R2 store with `keyPrefix: 'devnet/'` whenever `config.devnet` is set.
- **Refuses to start without both:** it checks `repo.namespace === 'devnet'` and `store.keyPrefix === 'devnet/'`.
- **Tested:** `test/emulator/devnet.hosted.test.ts`.
  - In devnet, every write is under `pocketqaNamespaces/devnet` and every R2 key starts with `devnet/`.
  - Staging and production are unchanged.
- **Firebase Auth isn't namespaced (P3).** Its users are **project-global**: a devnet preview signs in against the same Firebase Auth user pool as production. So:
  - devnet uses **only labelled synthetic `@example.test` identities**, the same list that gates server-signed operations (`POCKETQA_DEVNET_ALLOWED_EMAILS`);
  - the devnet namespace's `users` and `identities` documents are separate from production's, so a production account has no devnet profile, studies or wallet link;
  - nobody should sign in to the devnet preview with a real account.
- **Scope (Hamza):** devnet only. Mainnet stays disabled and unsupported. The mainnet genesis and the mainnet USDC mint are refused before any signature.

## 9. The step machine (`src/settlement/squads/devnet.ts`) and seam changes
- **The factory, (a):** `devnetSettlement({ repo, chain, now, limits, roles: { platform, arbiter, feeWallet }, allowedEmails })` returns a `DevnetSquadsSettlement`. It implements both `SettlementProvider` and `DevnetSettlementOps`, the latter adding `reserveFunding`.
- **Seam changes (please update your fake):**
  - `DevnetChain.mintInfo` returns `{ address, owner, decimals }`, and all three are checked.
  - `DevnetChain.createKeyFor(studyId)` is new; the seed derives from the platform secret.
  - `DevnetStepInput` for `multisig_create` takes `studyId` (no seed).
  - `ReceiptStep` gains `wire_b64`, so a rebroadcast resends the exact signed bytes, both signatures included.
  - `DevnetStore` (exported) is the Firestore store, at `repo.escrow.devnet` (null on SQLite).
  - `VaultReceipt` is the doc at `devnetVaults/{studyId}`.
- **The checks before every signature (pqa-qa P2-DA1/DA2):** `guard(builderWallet)` runs before every `prepare`, and also in `startupCheck()` and in `prepareVault`, which creates the multisig. It checks:
  - `assertPlatformSigner` against the pinned key, never another role, and never the study's builder wallet;
  - the arbiter key equals its pin;
  - the genesis;
  - the mint account's address, classic owner and 6 decimals;
  - the Squads and Memo programs.
- **Error codes:** `ErrorCode` gains `DEVNET_SPEND_CAP`, `APPROVAL_MISMATCH`, `COSIGNER_NOT_SEEN` and `VAULT_NOT_READY`, all 409.
- **Worker:**
  - `SettlementPending` means one step was sent or is confirming, or another run holds the lease. The item is skipped and the status kept.
  - `AwaitingCosigner` moves the settlement to `awaiting_approval`: no failure, no backoff, no attempt count.
  - Due settlements include `awaiting_approval`. The repo gains `setInFlightStatus`.
  - The pilot (SQLite) never raises either error, so its behaviour is unchanged.
- **What's not wired yet:** the RPC `DevnetChain`, the hosted devnet wiring (the platform-signer-backed chain plus the `startupCheck` at boot), the arbiter CLI and the fee sweep (`kind: 'fee'`, a domain change).

## 10. Hosted entry points, the test-only connectors, and the funding reference
- **Every hosted entry point uses one set of backends (item 1).** `hostedApp()` builds one `HostedDeps` through `hostedDeps(env)` → `hostedBackends()`, and these share its single `repo`, which is namespaced, and its single `store`, which is prefixed:
  - the API routes;
  - Firebase identity sign-in (the uid → user mapping goes through `repo.core`);
  - the `/jobs/settle` and `/jobs/sweep` cron routes and the inline slices (`runJob` → `runSettlement`, `sweepStorage`);
  - the deletion worker.

  No other place in `src/` opens Firestore or builds an R2 store; the namespace static test pins that. `test/emulator/devnet.hosted-app.test.ts` runs sign-in, the routes and both cron jobs in devnet, then finds nothing outside `pocketqaNamespaces/devnet` and no R2 object outside `devnet/`.
- **The test-only seam (item 2):** `hostedDeps(env, connectors?)` and `hostedBackends(config, env, connectors?)`.
  - **The connectors:** `HostedConnectors = { firestore(config, env), identity(config), r2(config), devnetChain(config, env), now }`.
  - **In production:** the Vercel entry passes none, so `productionConnectors` are used; a test asserts `vercel.ts` and `hostedApp` never pass connectors.
  - **No refusal is weakened:** the env is still the **real** devnet env and is validated by `loadConfig` exactly as in production. A `demo-` project or an emulator variable in the env is still refused, and a test pins that too. Only where the connections go is redirected: the emulators, a fake S3, `FakeDevnetChain`, a clock.
  - **Example:** `devnet.hosted-app.test.ts`.
- **The 403 on `createStudy` (item 3) was not the allow-list.** `hostedDeps` wired no settlement provider in devnet, so escrow studies got `FEATURE_UNAVAILABLE`, which maps to 403. Fixed:
  - the devnet adapter is wired;
  - `startupCheck()` runs at boot, proving the pins on chain before serving;
  - `createEscrowFunding` reserves the test USDC (CH-D1) and continues a vault that's still being created;
  - an off-list builder now gets a clean 403 before any signature.
- **The funding reference (item 4, for pqa-be1):** it's the **fifth account of the `TransferChecked` instruction**: read-only, not a signer, appended after `[source, mint, destination, owner]`. That's the Solana Pay convention, and `observeTokenTransfer` finds it among the transaction's account keys. There's no memo and no separate instruction. The server builds this transaction (CH-D3), so the client doesn't need to build it. It should decode and check it before asking the wallet to sign:
  - the pinned mint;
  - the destination equals `destination`, the vault's token account;
  - the amount equals `amountUnits`;
  - the fifth account equals `reference`;
  - `network` is `devnet`.

## 11. Journey blockers A–C
- **(A) Escrow studies in devnet:** the gate was the hosted wiring. `hostedDeps` gave devnet no settlement provider, and `createStudy` refuses escrow when `deps.settlement` is null. Fixed in `6bbc258`: devnet wires `DevnetSquadsSettlement`. Tests:
  - devnet: the allow-listed builder creates an escrow study and funds it through the routes (`devnet.hosted-app.test.ts`);
  - production (settlement `off`): escrow `createStudy` is still `403 FEATURE_UNAVAILABLE`;
  - staging is unchanged: it keeps its labelled **simulated** escrow (R11), which existed before this phase.
- **(B1)** Confirmed: the funding reference is the **fifth read-only account of `TransferChecked`**, the Solana Pay convention (see §10).
- **(B2)** `StudyPayment.refund` now carries `settlementId`, so the client can call `GET /settlements/:id/approval` for the refund. The fee sweep's settlement id will appear the same way when the fee sweep lands.
- **(B3) The server checks the on-chain vault transaction against the receipt** on every run, **before** creating the proposal and **before** its own vote and execute:
  - it re-reads the immutable vault transaction;
  - `sameTransfer` compares the creator, the op id, the program, `TransferChecked`, the source vault, the **mint**, the **destination token account**, the authority, the **amount** and the decimals.

  A vote's bytes prove nothing about the amount or recipient, so the server never relies on them. Tests in `devnet.adapter.test.ts` tamper the amount, the recipient or the mint, both before the proposal and after the builder's vote. Each time the payment is refused and the platform signs nothing more: no proposal, no vote, no execute.
- **(C) A non-devnet cluster fails closed at startup:** `buildHostedApp` runs `startupCheck()`. A mainnet genesis (for example from a mainnet RPC URL, which config accepts) or a wrong mint account means the app is never built and nothing is signed. Tested.

## 12. The RPC devnet chain (pqa-qa N-1)
- **The class:** `src/settlement/squads/rpcDevnetChain.ts`, `RpcDevnetChain implements DevnetChain`.
- **One key:**
  - `roles.platform` is the loaded signer's public key, and only that key ever signs, plus each study's derived create key for its one `multisig_create`.
  - There is no builder or arbiter key; their votes are wallet-signed transactions this class only builds, unsigned.
- **One `Connection`** to the configured devnet RPC, for the genesis, blockhashes, reads and sends. Reads are at `finalized`.
- **Signing:** `prepare` re-checks the genesis, then signs **without sending**.
- **Sending:** `broadcast` sends the exact bytes without waiting. A rejected send becomes `SettlementPending`, and the next run reads the signature's status.
- **Production wiring:** `productionConnectors.devnetChain` loads the signer and runs `assertPlatformSigner` against the pin and every role, then builds `RpcDevnetChain.connect(config.rpcUrl, signer, arbiter)`.
- **Tests, `test/devnet-rpc-chain.test.ts`** (a stub `Connection`, no network):
  - the platform is the fee payer, the only required signature, and ed25519-verified as the checked key;
  - the platform vote names the platform as member;
  - a mainnet genesis means nothing is built;
  - `broadcast` sends the exact bytes;
  - the funding transfer's fifth account is the read-only, non-signer reference;
  - the cosigner vote is unsigned, with the member as fee payer;
  - create keys are per study and never the platform key;
  - the production connector's chain uses the pinned key, and a mismatched key yields no chain.

## 13. The dispute overturn on devnet: the exact operator procedure
**The flow, as the code does it:**
1. The builder rejects.
2. The tester disputes.
3. An admin resolves the dispute **overturned**. pqa-be1's `resolveDispute` authorizes the tester's payout with cosigner **`arbiter`**.
4. The settle slice triggered by `resolveDispute`, or `/api/jobs/settle`, writes the receipt and creates the vault transaction and the proposal. The platform does **not** vote, and the payout is `awaiting_approval`.
5. Only the arbiter's vote unblocks it, given by `apps/api/scripts/devnet-arbiter.ts`: operator only, a key file, inputs read from the chain, no route.
6. The next slice or cron run then completes it: the platform votes and executes.

**Before step 3: a synthetic admin on the devnet namespace.** `apps/api/scripts/devnet-grant-admin.ts <email> --reason "…"` runs on the host with the devnet deployment's env.
- **Where it can grant:** it refuses anything but `POCKETQA_ENV=devnet` and **root (production) repositories**, and writes only under `pocketqaNamespaces/devnet`.
- **Who it can grant:** an allow-listed `@example.test` account that is verified (`devnet-verify-synthetic.ts`) and dedicated to administration (no wallet, no studies, no test sessions). The reason must be at least 10 characters.
- **Audit:** it's recorded as `user.admin_granted` by `host-cli`.
- **Production is never touched:** there's no production admin grant and no HTTP route.
- **Tests:** `test/emulator/devnet.admin.test.ts`.

**The arbiter's inputs:** they come from the read-only admin route `GET /admin/settlements/:id/devnet`, which is admin only, devnet only, and builds and signs nothing.
- **What it returns:** `{ settlementId, kind, cosigner, state, multisig, txIndex, opId, recipient, amountUnits, mint, network }` from the receipt.
- **Before the receipt exists:** `409`.
- **Check first:** the operator confirms `cosigner: 'arbiter'` and `state: 'awaiting_cosigner'`.

**The CLI:**
```
npx tsx apps/api/scripts/devnet-arbiter.ts --key-file <abs path, 0600 file in a 0700 dir> --arbiter <POCKETQA_DEVNET_ARBITER_PUBKEY> --platform <POCKETQA_DEVNET_PLATFORM_PUBKEY> \
  --multisig <multisig> --index <txIndex> --op <opId> --recipient <recipient> --amount <amountUnits> [--rpc <devnet url>] [--send]
```

**What it checks on devnet itself, before it signs** (any failure: "Refused, nothing signed: …", exit 1):
1. **Genesis:** the RPC's genesis hash is devnet's `EtWTRABZ…ZBG`.
2. **The vault transaction:** the Squads `VaultTransaction` account at `(multisig, index)` exists and is **owned by the Squads program**, and its **creator is the pinned platform key**.
3. **Exactly this payment** (`verifyVaultTransfer`):
   - vault 0, no lookup tables;
   - exactly `[TransferChecked, Memo]`, with the memo equal to the **op id**;
   - the **mint** is the pinned devnet test USDC, with **6 decimals**;
   - the source is the study vault's token account, with the vault as authority;
   - the **destination** is the recipient's token account;
   - the **amount** is exactly `amountUnits`.
4. **The multisig:** the arbiter key is a **voting member**.
5. **The proposal:** it exists and is **Active**. If it already holds the arbiter's vote, the CLI reports `alreadyApproved` and sends nothing.

**What it does:** without `--send`, nothing more (a dry run). With `--send`, it signs **one** `proposal_approve` (the shared `buildApproveTx`, with the arbiter as member and fee payer) and broadcasts it.

**What it prints:** public JSON only, `{ network: 'devnet', checked: { amountUnits, recipient, destination, source }, alreadyApproved, signature | null, sent }`. The key is never printed, and errors never contain it. Tests: `test/devnet-arbiter.test.ts`.

**A fix found while tracing this:** if a proposal reached **Approved** with the cosigner's vote plus another member's (for example the arbiter voting on a builder-cosigned payment), the platform would have retried a vote that fails on chain. It now votes only on an Active proposal and executes an Approved one (`de92f7d`).

## 14. The spend books equal the chain (lead request after E-28; (b) withdrawn per pqa-qa)
- **Seam change, so please update your fake:** `DevnetChain.costOf(signature): Promise<{ lamports, slot } | null>`. It returns what a finalized, platform-paid transaction cost its fee payer, fee plus rent (`preBalances[0] − postBalances[0]`), and null while it isn't finalized or can't be read. `RpcDevnetChain` implements it from `getTransaction` at finalized, and only when account 0 is the platform.
- **Recording:** `ReceiptStep.cost_lamports` (with `slot`) is written whenever a step resolves to finalized or failed. That happens both when the run follows its own step and when it only observes the effect.
- **The true-up:** it sums the observed costs, so the books equal the chain to the lamport, and it runs once per operation (the reservation's `released` flag).
  - **Cost unreadable:** where a cost can't be read, the step's estimate (an upper bound) counts, or one fee for a landed failure, so the books are **never below** the chain.
  - **Pending steps:** a step still `sent` that never landed costs nothing.
- **Funding reservations stay cumulative:** test-USDC reservations are **not** released on close (item (b), withdrawn).
- **Startup log (P3-CAP1):** the log now states `devnetSpent` (the namespace's global totals) next to `devnetSpendCaps`, as numbers. That comes from the new `DevnetStore.spendOf(id)`.
- **The historical gap:** `npx tsx apps/api/scripts/devnet-spend-report.ts`, with the devnet env, is **read-only**. Per operation it prints the reserved lamports against the observed cost of its recorded transactions (by signature), then the totals, the gap and the global books. It writes nothing; a test checks the reservations are byte-identical before and after.

## 15. E-29 and P3-SR1
- **Arbiter CLI funds check:** `ArbiterChain.balance(address)` is new. Before a dry run reports OK, and before `--send` signs, the arbiter key must hold at least `ARBITER_MIN_LAMPORTS = 10,000`: one vote fee of 5,000 plus a margin. Otherwise it refuses: "the arbiter key holds N lamports; its vote's fee needs at least 10000 (devnet SOL: fund the arbiter key first)". An already-cast vote needs no fee and is still just reported.
- **The spend report reads costs with the platform public key only:** `rpcCostReader(rpcUrl, POCKETQA_DEVNET_PLATFORM_PUBKEY)`, which shares its cost read with `RpcDevnetChain.costOf`. The script never loads the platform secret, and a static test pins that.
  - **One thing remains:** devnet config validation still requires one signer variable to be **set**. Use `POCKETQA_DEVNET_PLATFORM_SIGNER_FILE`, a path the report never reads.

## 16. The demo showcase (Hamza via the lead, 2026-10-07; devnet/demo scope only; QA bar qa-demo-showcase-acceptance-r1)

**Scope change (Hamza GO, 2026-10-07): visible on the hosted staging app, at most 10 in total.** This deliberately reverses QA bar C ("refused outside devnet") for staging only.

- **Config:** `config.demoShowcase` is `'off' | 'fixtures' | 'store'`. It replaces `config.devnet.demoShowcase`.
  - **staging → `'fixtures'`:** enabled in code, with no env variable (a Vercel env write is not ours to make). The route serves `demoProfileFixtures()` capped at `MAX_DEMO_PROFILES = 10`: 8 testers plus demo-9 and demo-10. It does **no Firestore read or write**, so production collections and the real leaderboard and ranks are untouched by construction. A test traps every repository and still gets 10.
  - **devnet → `'store'`** with `POCKETQA_DEMO_SHOWCASE=1`: the namespace `demoProfiles` store and the idempotent seed, as before, also capped at 10. The 12 stored documents are left as they are.
  - **production and development → `'off'`:** `/config` says `features.demoShowcase: false`, and the route returns 404 `FEATURE_UNAVAILABLE`. `POCKETQA_DEMO_SHOWCASE` is still refused outside devnet, staging included, with the same message.
  - Staging still refuses `squads_devnet`, with the message byte-identical.
- **Authz:** unchanged. `GET /demo/showcase` is **public** (no session), read-only, and has no payouts, ledger, points, aliases or users.

Clearly labelled SYNTHETIC sample profiles for demos. They are fixture documents, not accounts: no
Firebase Auth user, no `users` row, no participation, ledger, points, leaderboard profile or alias
reservation, and no payout.

- **Flag:** `POCKETQA_DEMO_SHOWCASE=1` is accepted only with `POCKETQA_ENV=devnet`. Any value
  in production, staging or development is refused, and in devnet it must be `1` or unset.
  - It sets `config.devnet.demoShowcase` and the client's `ClientConfig.features.demoShowcase` (default false).
- **Contract (lead decision):** `GET /demo/showcase` is public and returns `{ label: "Demo examples (not real users)", testers: DemoTester[], builders: DemoBuilder[] }`.
  - `DemoTester = { id, alias, qualityScore, decided, badges, demo: true }`.
  - `DemoBuilder = { id, alias, studiesPublished, demo: true }`.
  - Both are strict: no user id, email or wallet, and no earnings, credit or USDC field.
  - Rows come in fixture-id order and are not a ranking.
  - When off (no flag, or not the devnet namespace's repositories) the route answers **404 `FEATURE_UNAVAILABLE`**.
  - Stored documents that don't match the strict contract are never served.
- **Data:** `pocketqaNamespaces/devnet/demoProfiles/demo-1 … demo-10` (8 testers, then 2 builders), reached only through `devnetFirestore`.
  - **Cap (Hamza, 2026-10-07):** at most 10 demo profiles in total (`MAX_DEMO_PROFILES = 10`). The fixture is these 10, and the route serves only fixture ids, never more than 10.
  - Live devnet also holds `demo-11` and `demo-12`, seeded before the cap. They stay stored, unmodified and undeleted, and are never served. A seed over those 12 writes 0 and refuses nothing.
  - Store: `src/repo/escrow/demoProfiles.ts`, read and create only. SQLite has none.
  - Fixture: `src/devnet/demoShowcase.ts`, deterministic.
- **The real ranking:** `GET /leaderboard` and `/me/reputation` are unchanged and never read `demoProfiles`.
  - B3 and QA P3-D2: a real tester's alias may not read as "Demo…". `isDemoAlias` does this:
    1. NFKC-normalises the alias.
    2. Strips Unicode format characters (zero-width and similar) and leading spaces.
    3. Folds Cyrillic, Greek and Cherokee look-alikes of D, E, M and O to Latin.
    4. Tests `/^demo/i`.
    - This covers "DemoMaple", a bare "Demo" and "Demonstrator". The alias contract is ASCII-only, so non-ASCII look-alikes are already refused there with 400.
  - The seed's read-only pre-check refuses, writing nothing, while any real `leaderboardProfiles` alias in the namespace reads as "Demo…".
    - `leaderboardAliases` holds only hashed keys; the alias text lives on the profile.
- **`/config` (QA P3-D3):** every deployment's `GET /config`, production included, now carries `features.demoShowcase` (`false` everywhere but devnet with the flag).
  - Harmless: it is public configuration, and older clients ignore it.
  - It is not byte-identical to the previous `/config` response, so a byte comparison across this change will differ by that one field.
- **Seed:** `npx tsx scripts/devnet-seed-demo.ts`, with the devnet deployment's env. It refuses without `POCKETQA_ENV=devnet` and `POCKETQA_DEMO_SHOWCASE=1`, and refuses non-devnet repositories.
  - It runs one transaction. If any stored demo document differs from its fixture (a changed or extra field), it refuses, names the ids and writes nothing (QA D3: never overwrite).
  - Otherwise it creates only the missing documents, so a second run writes 0.
  - It prints `{written, unchanged, total, readBack}`. `readBack` counts the rows the route would serve.
  - It has no deletion or reset path.
- **Tests:**
  - `test/demo-showcase.test.ts` (unit and SQLite):
    - the fixture, the strict filter and the 404s;
    - B3 and A3;
    - A4: the seed runs against a stub where every repo member except the demo store throws;
    - D2 and D3 against the store contract;
    - static checks: no delete or update on the seed path, no Auth, the CLI gate.
  - `test/demo-seed-auth.test.ts` (QA P3-D1): every `firebase-admin/auth` export is a stub that records and throws. The seed's module graph is loaded and the seed runs, with zero Auth calls.
  - `test/devnet-config.test.ts` and `test/demo-showcase-config.test.ts`: the flag.
  - `test/emulator/devnet.demo.test.ts` (Firestore):
    - A2: per-collection counts, root and namespace;
    - D2: `updateTime` unchanged on run 2;
    - D3: a partial state, and a differing document refused untouched;
    - P3-D2: the alias pre-check reads only the namespace, and refuses while a namespaced Demo… alias exists;
    - the route;
    - B1: `/leaderboard` and `/me/reputation` byte-identical with and without the seed and the flag.
