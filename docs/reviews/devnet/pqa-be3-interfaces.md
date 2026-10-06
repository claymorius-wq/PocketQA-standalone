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
