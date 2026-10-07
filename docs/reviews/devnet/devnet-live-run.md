# Devnet live run: operator runbook (pqa-be3)

Scope: `POCKETQA_ENV=devnet` only. Solana **devnet**, devnet test USDC (`4zMMC9…ncDU`, no value). Mainnet is disabled and unsupported: the mainnet genesis and the mainnet USDC mint are refused before any signature, at startup and before every signing step. Contract: `docs/plans/devnet-phase-contract.md` with amendments r1. Interfaces: `pqa-be3-interfaces.md`.

**Copy on every money line:** "Devnet test USDC, no value · test keys · not independent custody."

**Never** put a value (key, secret, token, verification link) in this document, a commit, a log or an evidence file. Signatures go into evidence as prefix + sha256.

## 1. Bounds, stated in the run's row before anything is sent
- **Per run:** at most **3 test USDC** funded, and at most **0.05 SOL** in fees plus rent. That's 2 to 3 payments: a vault costs about 3.9M lamports, a payment about 5.2M plus 2.04M if the recipient has no token account.
- **The server enforces these cumulatively** (CH-D1). The defaults (`DEFAULT_DEVNET_LIMITS`) are 50,000,000 lamports and 3,000,000 test-USDC units, **per user and globally**.
- **The caps are configurable** (lead decision on E-28 #4) with `POCKETQA_DEVNET_CAP_GLOBAL_LAMPORTS`, `POCKETQA_DEVNET_CAP_USER_LAMPORTS`, `POCKETQA_DEVNET_CAP_GLOBAL_USDC_UNITS` and `POCKETQA_DEVNET_CAP_USER_USDC_UNITS`.
  - **Allowed values:** whole numbers, under a hard ceiling in code: **1 SOL** global, **0.5 SOL** per user, **10 test USDC** each. A per-user cap may not exceed its global cap.
  - **Refusals:** an out-of-range value refuses startup, and every one of these variables is refused outside devnet.
  - **Visibility:** the effective caps are logged at startup as numbers.
  - **Still cumulative:** raising a cap adds headroom, and nothing is reset.
  - Totals live in the devnet namespace at `devnetSpend/{global | user:<uid>}` and accumulate across runs.
  - Over a cap: `409 DEVNET_SPEND_CAP`, before anything is signed.
  - A new budget means resetting those documents. That's a reviewed operator action approved by the lead, never automatic.
- **Read and record before each run:**
  - the fixture balances: the platform's SOL, and the builder's SOL and test USDC;
  - the Squads program-data hash (CH-D6: `RpcDevnetChain.programDataHash()`);
  - pqa-qa's read-only production integrity check (`apps/api/scripts/qa-integrity-check.ts`).
- **After the run:** read the same three again. Production counts must be unchanged.

## 2. The keys: one on the server, none from a role that isn't the platform's
| Key (fixture) | Where it lives | Who signs with it |
|---|---|---|
| Platform signer `poc…` | Vercel **Preview** env only (`POCKETQA_DEVNET_PLATFORM_SIGNER`), or locally a 0600 file in a 0700 directory (`POCKETQA_DEVNET_PLATFORM_SIGNER_FILE`) | The server: creates vaults, vault transactions and proposals; casts the **second** vote; executes |
| Builder `bui…` | The builder's own wallet (Phantom or MWA). Harnesses use a test wallet. **Never server env.** | The builder: funding transfers and the first vote on their payouts, refund and fee sweep |
| Arbiter `arb…` | Operator machine only, a 0600 file in a 0700 directory | The operator, via the arbiter CLI (§6), for arbiter-cosigned payments |

- **The server's checks:** at startup and before **every** signature, the server proves that its key is `POCKETQA_DEVNET_PLATFORM_PUBKEY` and isn't the arbiter, the fee wallet or the study's builder wallet (P2-DA1). It also proves the genesis, the mint's address, owner and decimals, and the Squads and Memo programs (P2-DA2).
- **Production refuses all of these variables** (CH-D4).

### 2.1 Rotating the platform key orphans existing vaults (pqa-qa P3-R1)
- **Why:** each study's Squads create key is derived from the platform secret (HMAC, domain `pocketqa/devnet/create-key/v1/`). The platform key is also a member of every study multisig.
- **What a new platform key does:** it derives different multisig addresses, and it isn't a member of the existing ones. Every existing vault becomes unreachable to the server: no vault transaction, proposal, vote or execute.
- **So rotate only when every devnet study vault is empty and closed:** refund and fee sweep confirmed, vault balance 0 on chain.
- **If the old key is compromised before then:** drain with the old key first. As a last resort, the builder and the arbiter can approve a manual vault transaction, but only a member with Initiate can create one, and that's only the old platform key. Treat a compromise as "devnet test funds lost", which is acceptable on devnet but must be written up.

## 3. Environment for a loopback run of the devnet artifact (names only)
- **Build:** `node scripts/vercel/build.mjs --env devnet`. The build's app CSP alone allows the pinned devnet RPC.
- **Serve on loopback:** `node scripts/vercel/serve-local.mjs --port <port> --dir .vercel/output`.

The function reads these from the environment at runtime:

| Name | Notes |
|---|---|
| `POCKETQA_ENV` | `devnet` |
| `POCKETQA_DATA_BACKEND` | `firestore`. Data goes to the devnet namespace `pocketqaNamespaces/devnet` only (CH-D2) |
| `POCKETQA_AUTH_MODE` | `firebase` |
| `POCKETQA_FIREBASE_PROJECT_ID`, `POCKETQA_FIREBASE_WEB_API_KEY`, `POCKETQA_FIREBASE_AUTH_DOMAIN` | Public web config of the real project (not `demo-`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server-only secret |
| `POCKETQA_PUBLIC_ORIGIN` | **The https preview origin, even for a loopback run.** Devnet is "secured", so a loopback origin is refused (pqa-ios) |
| `POCKETQA_STORAGE` | `r2` |
| `POCKETQA_R2_ACCOUNT_ID`, `POCKETQA_R2_BUCKET`, `POCKETQA_R2_ACCESS_KEY_ID`, `POCKETQA_R2_SECRET_ACCESS_KEY`, `POCKETQA_R2_ALLOW_DELETE` | Objects go under `devnet/` only. The deletion worker can't reach `evidence/` or `retained-local-submissions/` |
| `POCKETQA_SETTLEMENT` | `squads_devnet` |
| `POCKETQA_SOLANA_RPC_URL` | Optional (default: the public devnet RPC). The cluster is proven by the genesis at startup, never by the hostname |
| `POCKETQA_DEVNET_PLATFORM_SIGNER_FILE` (local) or `POCKETQA_DEVNET_PLATFORM_SIGNER` (Preview) | Exactly one |
| `POCKETQA_DEVNET_PLATFORM_PUBKEY`, `POCKETQA_DEVNET_ARBITER_PUBKEY`, `POCKETQA_DEVNET_FEE_WALLET` | Public keys, three different ones |
| `POCKETQA_DEVNET_ALLOWED_EMAILS` | The synthetic `@example.test` accounts allowed to start server-signed operations (§4) |
| `POCKETQA_DEVNET_CAP_GLOBAL_LAMPORTS`, `POCKETQA_DEVNET_CAP_USER_LAMPORTS`, `POCKETQA_DEVNET_CAP_GLOBAL_USDC_UNITS`, `POCKETQA_DEVNET_CAP_USER_USDC_UNITS` | Optional cumulative caps (§1), under hard ceilings |
| `CRON_SECRET` | Server-only. Previews get **no Vercel Cron**, so settlement runs as bounded request slices, or the operator calls `/api/jobs/settle` with the secret |

**Leave unset:**
- `POCKETQA_TRUST_PROXY` (pqa-ios);
- `POCKETQA_SETTLEMENT_PILOT_KEYS_DIR` (refused in devnet);
- every emulator variable (refused);
- `POCKETQA_SHARED_DEMO`.

The local server (`src/server.ts`) refuses `POCKETQA_ENV=devnet` (P3-F3). Only the hosted entry runs it.

## 4. Synthetic identities (Firebase Auth is project-global)
A devnet deployment signs in against the **same Firebase Auth user pool** as production. Its Firestore data, though, is separate: users, studies and wallet links all live in the namespace. Nobody signs in to the devnet preview with a real account.
1. **Choose the accounts:** for example `devnet-builder@example.test` and `devnet-tester@example.test`. List them in `POCKETQA_DEVNET_ALLOWED_EMAILS`; config refuses any other domain.
2. **Create them:** sign up each one in the devnet app (email and password) and choose the role (builder or tester).
3. **Verify the email without a mailbox:** with the project's server credentials in the environment, run `npx tsx apps/api/scripts/devnet-verify-synthetic.ts <email>`.
   - It refuses anything but an allow-listed `@example.test` address, before contacting Firebase.
   - It prints the single-use verification link. Open it in the browser, then sign in again.
   - Never paste the link into a document or evidence file.
4. **Link wallets:** each account links its wallet in the app (a SIWS signature). The builder uses the builder test wallet; the tester uses its own wallet, which receives the payout.
5. **For the dispute path, a synthetic admin:** sign up `devnet-admin@example.test` (on the allow-list, with **no** wallet, studies or test sessions) and verify it as in step 3. Then, on the host with the devnet env, run `npx tsx apps/api/scripts/devnet-grant-admin.ts devnet-admin@example.test --reason "<why>"`. It writes only under the devnet namespace and refuses anything else (`pqa-be3-interfaces.md` §13).

## 5. The journey, and who signs what
1. **Create the study.** The builder creates an escrow study (payment `escrow`).
2. **Fund:** `POST /studies/:id/escrow/fundings`.
   - The server reserves the test USDC against the caps.
   - It prepares the study vault one transaction per request: the multisig with members builder, platform and arbiter, then the vault token account.
3. **Get the funding transaction:** `GET /escrow/fundings/:id/transaction` answers `409 VAULT_NOT_READY` until the vault exists, then returns the unsigned transfer.
4. **The builder's wallet signs and sends it.** The client posts the signature to `POST /escrow/fundings/:id/signature`, and the server reads the chain before confirming.
5. **Publish, consent, submit, approve:** the payout settlement is authorized.
6. **Settle.** The server writes the receipt, then creates the vault transaction and the proposal. It **doesn't vote**, and the payout is `awaiting_approval`.
7. **Approve.**
   - **The builder votes:** `GET /settlements/:id/approval` returns an unsigned vote bound to `(multisig, index, op id)`. The wallet signs and sends it.
   - **The client confirms:** `POST /settlements/:id/approval`.
   - **The server completes it:** it verifies the vote on chain, then the platform votes and executes.
   - **Asking twice:** once the vote is on chain, the GET answers `409 ALREADY_APPROVED`.
8. **Close.** The same transaction authorizes:
   - the **refund** of the unused vault to the funding wallet;
   - the **fee sweep** of the earned fees to `POCKETQA_DEVNET_FEE_WALLET`.

   Both are cosigned by the builder (P3-S1) and approved like a payout, through `StudyPayment.refund.settlementId` and `StudyPayment.feeSweep.settlementId`.
9. **Expected result:** vault 0 on chain; the fee wallet up by exactly the booked fees; the books balanced (`sweptFeesUnits`).

## 6. The arbiter (dispute overturn) and arbiter recovery (P3-S1)
- **When the arbiter cosigns:** an admin resolving a dispute as **overturned** authorizes the tester's payout with cosigner **arbiter**. The settle run creates the vault transaction and proposal, then waits for the arbiter's vote.
- **The operator's steps:**
  1. **Read the payment:** as the devnet admin, call `GET /api/admin/settlements/<settlementId>/devnet` (read-only). Check `cosigner: 'arbiter'` and `state: 'awaiting_cosigner'`, then take the multisig, txIndex, opId, recipient and amountUnits.
  2. **Dry run (no `--send`):** it reads devnet itself and checks that this is exactly that payment, created by the pinned platform key, with an Active proposal and the arbiter a voting member:
     ```
     npx tsx apps/api/scripts/devnet-arbiter.ts --key-file <abs path to the arbiter key file> --arbiter <POCKETQA_DEVNET_ARBITER_PUBKEY> --platform <POCKETQA_DEVNET_PLATFORM_PUBKEY> \
       --multisig <multisig> --index <n> --op <pqa-op1:…> --recipient <tester wallet> --amount <units>
     ```
  - **The arbiter key pays its own vote's fee (E-29).** Fund it with a little devnet SOL first. Both the dry run and `--send` refuse below **10,000 lamports** (one signature's fee plus a margin), so "dry run OK" means the send can succeed.
  3. **Vote:** the same command with `--send` votes once with the arbiter key. It prints the public vote signature only, never the key. A second run reports `alreadyApproved`.
  4. **Completion:** the next settle slice or `/api/jobs/settle` run completes it: the platform votes and executes.
- **Arbiter recovery for builder-cosigned payments, when the builder can't or won't vote:** refunds, fee sweeps and payouts approved by the builder wait for the **builder's** vote. The server never completes a builder-cosigned payment on the arbiter's vote, even though the arbiter is a member.
  - **What's automatic:** the arbiter is the cosigner in two cases.
    - **Account deletion:** a builder who deletes their account has their refund authorized with cosigner arbiter.
    - **A funding confirmed after close:** that refund is authorized with cosigner arbiter too.
  - **What isn't:** any other recovery means changing a settlement's cosigner to `arbiter`. That's a **reviewed data repair**, a plan approved by the lead and pqa-qa, with no route or automation. After it, the arbiter CLI is used as above.

## 7. Evidence for QA (B3)
- **Per operation:** funding, payout, dispute overturn, refund and fee sweep, record:
  - the signature, as prefix + sha256;
  - `finalized`;
  - the slot;
  - the fee payer;
  - the pre and post token-balance deltas, which must equal the ledger integers;
  - the op id.
- **The receipts:** the `squadsAttempts/<settlementId>` receipts in the namespace hold every platform-signed step's message and signature, written before its broadcast.
- **After the run:** the program-data hash, the fixture balances and the production integrity check (§1).
