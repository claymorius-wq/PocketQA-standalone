# Devnet phase contract (2026-10-06)

Authorized by Hamza: an integrated devnet user journey, with bounded fresh **devnet-only** test transactions using the dedicated Pocket QA fixtures (`~/.config/pocketqa-devnet-pilot`). Not mainnet, real funds, billing or deletion. Lead: pocketqa-lead (wX:p1). Independent review: pqa-qa (wX:p2), against `docs/reviews/devnet/qa-devnet-readiness-acceptance-r1.md` (QA's bar, written before this plan).

## Immutable base
- Base: `feat/firebase-vercel` at the commit that records this contract. Each lane branches from it in its own worktree. Production stays `dpl_GPVCsNcfhQ6RufakYjqA18GmUkBX` (pocketqa.vercel.app, settlement **simulated**), unchanged by this phase.
- **Pinned** (read fresh 2026-10-06 and in code):
  - cluster: devnet, RPC `https://api.devnet.solana.com`;
  - genesis hash: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (`settlement/squads/pins.ts`);
  - mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (test USDC, 6 decimals, no value);
  - token program: classic `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`;
  - Squads v4: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`.
  - A test asserts that the mainnet USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and any non-devnet genesis are refused.

## Architecture: add a mode, never weaken a guard
1. **New env `POCKETQA_ENV=devnet`.** Every existing refusal stays byte for byte: production refuses all settlement but `off`; staging, the shared demo and the hosted app refuse `squads_devnet`. The new mode has its own guards:
   - it runs only with `settlement=squads_devnet`;
   - it refuses a non-devnet genesis or mint;
   - it loads **only** the platform signer.
2. **Custody: the server holds ONE key**, Pocket QA's platform signer (`poc…`). Signing works like this:
   - Builder funding and the builder's approval are signed by the **builder's own wallet** in the browser: wallet standard on web, MWA on Android. Harnesses drive the `bui…` fixture through a test wallet; it is never placed in server env.
   - The server signature only completes a 2-of-3 whose other signature is the authenticated builder's, so no visitor can make the server sign anything unilaterally.
   - The arbiter (`arb…`) is **operator-only**: a CLI, never a route.
   - Testers only receive; the payout address is frozen at consent.
   - This is still not independent custody, and the UI says so.
   - The signer variable joins `build.mjs`'s server-only scan list.
3. **Durable state on Firestore**, not SQLite:
   - escrow, funding, payouts, receipts and leases go through the Firestore repo;
   - devnet data lives in an **isolated namespace** (a collection prefix or equivalent) in project `pocketqa-optijara`, never in the production collections that hold Hamza's account and the Seeker evidence;
   - Firestore rules cover the namespace (client access denied, as in E-14).
4. **Crash safety, without server memory or timers.**
   - The receipt (op id, intended transaction, amounts, signer roles) is written durably **before** submit.
   - A retry first reads the chain by op id (memo/signature) and **adopts** a landed transaction instead of re-sending.
   - Retries are driven by a request or cron (`CRON_SECRET` routes), never `setTimeout`.
   - A Firestore-transaction lease per op fences N concurrent runs to 1 execution.
   - No duplicate external payout, by construction and by test.
5. **Deployment:** a Vercel **preview** deployment of the same project, with devnet env in the Preview environment and its own alias. Production is never re-pointed. If Vercel Deployment Protection covers previews, that is an external gate for Hamza; we never disable it ourselves.
6. **Copy:** every amount reads "devnet test USDC, no value". The custody disclosure stays.

## Bounds for fresh sends
- Fixture funds read before each run (latest: pocketqa ≈ 4.96 devnet SOL, builder ≈ 17.79 test USDC).
- Per run: at most **3 test USDC** funded in total and **0.05 SOL** in fees. Each run states its bounds in its row before sending.
- Original pilot receipts are preserved; new receipts go in new files. Signatures are stored as prefix + sha256 (the check:secrets-compatible scheme).
- No user wallet, no private key in the repo, logs, bundle or config output. Never print a secret.

## Lanes (each in its own worktree, `claude --model claude-opus-5-5`, launched through the Herdr CLI)
| Lane | Agent | Worktree / branch | Owns |
|---|---|---|---|
| Hosted tester/builder E2E | pqa-be1 | firebase-vercel → `fix/e2e-h33` for the H-33 fix | H-33 fix (stale approve retry); then the devnet browser journey on the preview |
| Ledger safety and races | pqa-be2 | `devnet-races` | lease/fencing, crash-after-submit adoption, concurrent settle = 1, refusals, the authz matrix for the new routes |
| Durable devnet adapter | pqa-be3 (new) | `devnet-adapter` (`feat/devnet-adapter`) | `POCKETQA_ENV=devnet`, Firestore namespace, platform-signer-only custody, receipts before send, mainnet refusal tests, the preview deployment build |
| Test network and device readiness | pqa-ios | native-ios | D-08 fresh pilot run (SQLite, server-held pilot keys: labelled, NOT the integrated journey), APK/devnet build readiness, physical Seeker gates |
| Review | pqa-qa | qa-firebase-vercel | exact-SHA checks per QA r1 (B)/(C), RPC readback per op |

## Acceptance (QA r1 (B)/(C), unchanged)
- A real hosted API/browser → devnet path on the Firestore adapter: buyer funding → confirm → consent → submit → approve → on-chain payout → fee/refund/dispute, with QA's own RPC readback per op (finalized, slot, payer, token deltas equal to the ledger integers, op id).
- Crash-after-submit adopts; N concurrent settles = 1; on-chain refusals; no key in the repo, logs or bundle.
- Final matrix: original FAILs kept with their fix evidence; no hidden NOT RUN.

## External gates (stated flat)
Human Google login; Seeker USB-debugging and OS prompts (needs Hamza at the device); independent custody (all fixture keys are ours); mainnet (not authorized); Vercel preview protection if it is on.

## Amendments r1 (pqa-qa contract review r1, CHANGES_REQUIRED → adopted; lead decisions on pqa-be3's design note)
- **CH-D1 (P1) spend control.**
  - In devnet mode, only a server-side **allow-list of labelled synthetic accounts** may start any server-signed operation.
  - **Per-user and global devnet spend caps** (lamports and test-USDC units) are checked durably before every server-signed send.
  - The shared rate limiter covers every send route.
  - All of it is covered by tests (pqa-be2 E-25/E-26).
  - Per-payment rent (multisig ≈1.82M lamports, ≈5.14M lamports per payment, non-reclaimable) counts against the cap. Per-run bound: **0.05 SOL in fees + rent** (fewer than 10 payments) and 3 test USDC.
- **CH-D2 (P1) isolation.**
  - A separate **named Firestore database** is a billing/infrastructure change: Hamza's decision.
  - Until he decides: **one** namespace function (every devnet collection goes through it), a **static test** that no collection literal bypasses it, an **emulator test** that a full devnet journey writes **0 documents outside** the namespace, and the pqa-qa read-only integrity check on production **before and after every live run** with unchanged production counts.
  - R2: a separate devnet prefix; the deletion worker cannot touch `evidence/` or `retained-local-submissions/` (test).
- **CH-D3 server-built transactions.**
  - The server builds the builder-signed funding/approval transactions from its own state: pinned mint + classic Token, builder ATA → **this study's** vault, the quoted amount.
  - A tampered request is refused before any signing; an approval is bound to the exact vault transaction index + op id. (This is also the lead's decision on be3's question 3.)
- **CH-D4 signer placement.** The platform signer lives only in the Vercel **Preview** env (`vercel env ls` per environment recorded). It is in the deploy scan list, and the count shows it; production config refuses it (test).
- **CH-D5 receipts.** The receipt holds the **serialised message + signature before broadcast**. A retry queries that signature first, then memo/op id, and adopts.
- **CH-D6 disclosure.** Copy adds "test keys · not independent custody". The Squads devnet program is single-key upgradeable: its program-data is re-read before and after each live run.
- **CH-D7.** The D-08 pilot run is labelled "not the integrated journey".
- **Lead decisions on be3's note:**
  - Fee: option **(a)**, a fee sweep on close to a platform fee wallet (new posting kind; the domain change is reviewed by pqa-qa) so every booked movement has an on-chain receipt.
  - Existing refusals are **wrapped, not removed**: messages and behaviour byte-identical for every existing env (tests).
  - be1's client consumes the server-built transactions.
- **Preview protection.** Evidence so far: immutable production deployment URLs 302 to Vercel SSO (Standard Protection), so preview aliases are expected to be protected. Browser access to the preview needs Hamza: Vercel login for testers, a shareable link, or an automation bypass. We never disable protection. Firebase authorized domains must include the preview alias (console: Hamza/parent). Vercel Cron does not run on previews, so settlement there is driven by bounded request slices.
