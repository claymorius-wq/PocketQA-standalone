# Pocket QA: end-to-end product acceptance

Requested by Hamza; coordinated by Malik. This is an execution checklist, not a claim of passing results. Test the current immutable candidate and bind each result to deployment/SHA, environment, command or browser steps, account/fixture IDs, observed result and evidence path. Status vocabulary: PASS, FAIL, BLOCKED, NOT OFFERED, NOT RUN. Distinguish hosted simulated settlement, emulator tests, physical Android, and Solana devnet. Mainnet/real funds are not authorized.

## Baseline
Parent live /api/config readback: Firebase auth, private R2, Google enabled, walletLogin=false, testCredits=true, devnetTransfers=false, settlement=simulated. Re-read before executing. No existing user/account/media deletion, no billing upgrades, no user impersonation. Use labelled synthetic tester/builder accounts and studies. Preserve the user's Seeker submission and archived recording.

## Checklist (all NOT RUN in this new acceptance pass)
- [ ] Freeze candidate, deployment identity and enabled features; inventory every exposed route and all 11 pitch-deck slides.
- [ ] Tester and builder email registration, verification, login, recovery, role persistence and correct home routing.
- [ ] Google sign-in/signup UI and popup; actual Google completion needs an authorized human, never mocked as live proof.
- [ ] Both-role logout, revoked tokens, reload/back/private-route denial, account switching without data leakage.
- [ ] Tester profile/device/language persistence and positive/negative study eligibility.
- [ ] Builder study draft/edit/tasks/criteria/reward/slots/fee quote, insufficient budget refusal, funding and publish.
- [ ] Tester join, capacity races, consent, task notes, withdrawal/resume and destination binding where supported.
- [ ] Screen/mic consent, deny, stop, interruption, review, retain/discard; desktop and physical Seeker reported separately.
- [ ] Browser upload over 4.5 MB to private R2, CORS allowed/disallowed origin, finalization/retry, file hash and playback.
- [ ] Submit participation; builder sees only own study evidence and writes findings; cross-account evidence denied; URL expiry.
- [ ] Builder approve, duplicate approve, reject with reason; tester dispute and authorized admin resolution on synthetic fixtures.
- [ ] Funding/reservation/settlement/refund/platform-fee lifecycle: before/after integer ledger reconciliation and persistence.
- [ ] Budget exhaustion, concurrent approvals, duplicate requests, crash/retry and dispute/refund races; no double settlement.
- [ ] Close/cancel study and release/refund unused budget; separately label simulation versus devnet proof.
- [ ] Devnet escrow: inspect existing runner/receipts, re-read finalized transaction and balance evidence, run safe bounded fresh checks only with isolated test funds and clear operation identities; never substitute historic receipts for a new E2E pass.
- [ ] Reputation awards once per accepted work, badges, helpful marks, opt-in leaderboard and privacy; legitimate disputes not penalized.
- [ ] Settings, connected-wallet state, export and account-erasure behavior (destructive checks emulator-only unless synthetic-only deletion separately authorized).
- [ ] Server-only secrets, admin self-promotion denial, role isolation, Firestore rules and persistent reload/redeploy state.
- [ ] Map every advertised claim to PASS/FAIL/BLOCKED/NOT OFFERED and update final checklist with evidence.

## Devnet integrated journey (added 2026-10-06 by Hamza's devnet authorization; contract: `docs/plans/devnet-phase-contract.md`)
- [ ] Pins read fresh and enforced: devnet genesis, test mint `4zMMC9…`, classic Token, Squads v4; mainnet USDC mint and a non-devnet genesis refused by tests and at runtime.
- [ ] New `POCKETQA_ENV=devnet` mode; every existing production/staging/shared-demo/hosted refusal unchanged (tests).
- [ ] Custody: the server loads only the platform signer; the builder signs funding/approval in their own wallet; the arbiter is operator-CLI only; no route makes the server sign alone; no key in the repo, logs, bundle or config output.
- [ ] Durable Firestore adapter in an isolated namespace (no devnet data in production collections); rules deny client access.
- [ ] Hosted preview journey (real browser + test wallet): builder funds → confirm (finalized readback) → publish → tester consents (payout address frozen) → submit → approve (2-of-3) → on-chain payout → platform fee → close refunds unused rewards + fees; dispute path.
- [ ] Per-op independent RPC readback (pqa-qa): finalized, slot, payer, token deltas = ledger integers, op id.
- [ ] Receipt written before every send; crash-after-submit retry adopts and never re-sends; N concurrent settles = 1 execution; duplicate requests idempotent; no timers or server memory.
- [ ] On-chain refusals (wrong mint, threshold, double execute) recorded.
- [ ] Copy: "devnet test USDC, no value" everywhere; custody disclosure; production still shows simulated.
- [ ] Fresh bounded pilot run (SQLite, server-held pilot keys), labelled separately; never counted as the integrated journey.
- [ ] Deployment identity of the preview (and APK, if built) bound to the reviewed SHA; Vercel preview protection state recorded.
- [ ] Read-only production integrity check (E-08 class, ledger, escrow): run 2026-10-06T19:31Z, 0 violations.

## Economics explanation required
Trace actual source and UI: credit issuance, purchase/redemption/withdrawal capability, denomination and precision, builder budget, reward pool, fees, tester balance, devnet USDC mint and real USDC distinction, reputation-point isolation. Explain which values are simulated bookkeeping rather than money. Do not invent exchange rates or change the buyer-funded business model. Flag inconsistent copy with exact route and suggested correction.

## Deliverables
1. Evidence-backed row-by-row checklist in docs/reviews/full-e2e/checklist.md and machine-readable results.json.
2. Concise credits-vs-USDC-vs-reputation explanation with source references.
3. Reproducible bug list and independently reviewed corrective changes where authorized; re-run affected flows after fixes.
4. Explicit actual-human/physical-device/mainnet gaps. No blanket 'everything works' from aggregate test counts.
