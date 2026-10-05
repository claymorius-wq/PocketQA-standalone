# Wallet-funded testing, escrow and tester reputation

Status: **approved for implementation, simulated settlement only** (Hamza, 2026-10-05, relayed by the parent; scope recorded in `docs/decisions/0007-wallet-escrow-settlement.md`). Devnet escrow programs, platform-held keys, live devnet transfers, mainnet, real funds, charged fees and production activation still need separate approval. Original status line: "proposed; voice-feedback plan only. Attribution: Hamza product clarification; Malik code inspection and first-party documentation. No application changes, mainnet deployment, contract funding or fees authorized by this plan. Supersedes the assistant's suggested unpaid-pilot direction as a recommendation, not an implemented decision."

## Product intent
Companies fund tests from a wallet. Testers earn real rewards for valid work. Pocket QA administers disputes and earns a disclosed fee; it should not subsidize the reward pool. Points, rankings and visual badges reward quality in addition to payments, not replace promised money. Budget example: 10 USDC reward pool, 10 accepted tests at 1 USDC each; fees and account/network costs separate. USDC is a dollar-pegged asset, not a guaranteed dollar redemption for every user.

## Verified current boundary
- apps/api/src/handlers/studies.ts: publishing reserves rewardCredits in the internal ledger, not a funded blockchain vault.
- apps/api/src/handlers/participations.ts: approval posts reward_credit; it does not settle a real payment.
- apps/api/src/handlers/admin.ts: existing dispute resolution is an integration point.
- apps/api/src/handlers/wallet.ts: transfers are devnet demonstrations, disabled in production.
- apps/mobile/src/wallet/: existing connection/signature UX is reusable but does not constitute escrow.
- Preserve existing modified preview screenshots and untracked cloud-access notes; no blanket staging/reset.

## Proposed flow
1. Company chooses reward per accepted test, number of slots, tasks and acceptance criteria. Quote separately shows reward pool, platform fee and estimated network/account costs, including refund treatment.
2. Company signs USDC funding transaction from its wallet to a per-study escrow vault. Publish only after verified correct-network, mint, recipient, amount and finalized funding. Use integer token units, never floating-point money.
3. Eligible tester reserves a bounded slot; reserved total cannot exceed confirmed available budget. Freeze payout wallet for that participation with explicit consent and controlled recovery.
4. Tester submits evidence; no payment solely for uploading bytes. Backend validates completeness; builder reviews quality under a bounded deadline.
5. Approval authorizes exactly one payout from escrow to the tester. Automation needs a transaction submitter and narrowly scoped release authority; a smart contract cannot judge video quality. Show approved/payment-pending separately from confirmed paid.
6. Dispute freezes only the affected reward. A defined adjudicator resolves it. Review inactivity needs a documented escalation/timeout rule; never allow indefinite builder withholding or instant fake-submission cashout.
7. Refund uncommitted/unearned funds after closure/deadlines without consuming accepted/disputed obligations. Define platform-fee refund policy before implementation.

## Contract/provider selection gate
Use USDC on Solana as the candidate network/asset for existing Seeker/MWA alignment. Prefer a maintained, independently audited escrow implementation over custom mainnet code, but none has been selected or verified safe yet.

Official payment primitive: https://docs.solanapay.com/ documents wallet payment requests and SDK; that is not proof of a conditional work-escrow/dispute service. Fees are in SOL: https://solana.com/docs/core/fees . Account creation, priority fees, relayer/RPC, storage and support must be priced too; do not promise free payments.

Discovery-only example: https://github.com/wienerlabs/covenant advertises conditional job escrow and disputes, but its search listing identifies devnet/hackathon deployment. Not an endorsed production dependency and audit/mainnet/license suitability remain unverified.

Compare provider candidates for partial payouts, unknown recipients until assignment, refund/cancel/dispute deadlines, authorities/upgrade keys, custody, audit version matching deployed program, commercial license, program verification, supported token mint, fees, operational SLA and key recovery. A generic admin wallet collecting funds creates custody/key/compliance exposure; do not market it as trustless escrow. Escrow still has program and adjudication trust assumptions.

## Implementation workstreams (not started)
A. Provider/contract feasibility and economics: verify primary sources and deployed authority model; model small-study fixed and variable costs. For illustrative 10% fee on top of 10 USDC rewards, platform fee is 1 USDC and company pays 11 USDC plus network/account costs. Not selected pricing or a profitability claim.
B. Settlement domain/contracts: funding, reservations, approval, payout intent, dispute, refund, chain confirmation. Separate real monetary ledger from reputation and legacy test credits.
C. API integration: adapt studies.ts, participations.ts and admin.ts; add isolated payment provider/client and idempotent worker with unique payout per participation, chain reconciliation, durable retries, duplicate webhook/event rejection and operational alerts.
D. Wallet/UI: explicit network/token/amount/fee approval; funding confirmation; payout pending/confirmed/failed states; no seed phrase collection or master transfer permission.
E. Reputation: append-only points events only for verified accepted work; unique participation rewards; reversal/correction after upheld fraud. Do not penalize honest negative findings or choosing to dispute. Separate earned-money history from points. Opt-in display names, no public wallet/email exposure.
F. Badges and leaderboard: proposed First Accepted Test, Reliable Tester, Helpful Feedback, Device Specialist. Quality/reliability weighted, minimum sample sizes and recency windows; no raw-volume or deposit-size ranking. Moderated fraud controls for Sybil wallets, duplicate clips and builder/tester collusion. No tradeable token or NFT required. Produce visual badge design proposals before production assets.
G. Security/release: devnet integration first, independent contract/backend review, staged mainnet limits only after explicit authorization and legal/custody assessment. Real wallet/device testing distinct from mocks.

## Acceptance tests
Insufficient funding/wrong mint/wrong chain rejected; double-signature reuse does not double-credit; concurrent reservations bounded; double approval/retries do not double-pay; malicious payout destination changes rejected; failed tx never paid; late confirmation reconciled; dispute reward not refunded twice; underfunded relayer and missing token-account handling; crash recovery; withdrawal/cancellation with active tasks; points idempotency and fraud reversals. Evidence remains private and funded-study retention must satisfy dispute and approved deletion policy.

## Open product decisions
Exact platform fee, who pays SOL/account costs, review and dispute windows, release authority, refunds, eligible countries/compliance, payout minimum versus batching, sponsor limits and initial reward range. One-dollar tests should be brief and tightly scoped; adequacy and fraud economics require pilot evidence.

Deliverable of this turn: explanation and this proposal only. No funds moved or production behavior changed.
