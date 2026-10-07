# Test credits, USDC and reputation: what each one is

Traced from the source at `7beaad5`/`a8ea776` and the live `/api/config` of `dpl_GAmobrPxJNns8u1sHaSU2GrXVhJz` (2026-10-06). **None of the three is money a person can be paid out on the live site today.**

## Short version
| | Test credits | "USDC" in the app | Reputation points |
|---|---|---|---|
| What it is | Bookkeeping units for trying the product | A study reward stated in USDC units, settled by a **simulation** (hosted) or the **devnet pilot** (test tokens, no value) | A record of accepted work |
| Where it comes from | Minted on request: a builder taps "Add test credits" (`POST /me/credits/test-topup`, 1 to 10,000 at a time) | Hosted: a simulated wallet payment. Devnet pilot: a devnet test mint, never mainnet USDC | Earned only when a builder (or an admin) accepts the work |
| Cash value | None ("no cash value") | None on hosted (simulation) and none on devnet (test tokens) | None; not a token, not tradeable |
| Can be bought, sold, withdrawn, converted | No: no purchase, redemption or withdrawal exists | No real transfer exists anywhere: production config refuses any settlement but `off` | No: "can't be withdrawn, sold or turned into credits" |
| Platform fee | None | 10% per **approved** test (`POCKETQA_ESCROW_FEE_BPS` default 1000), rounded up to a whole base unit; unused slots' rewards and fees are returned on close | None |
| Precision | Whole credits (integers) | Integer base units, 6 decimals (1 USDC = 1,000,000 units), no floating point | Integer points |

## Detail, with sources
- **Test credits** (`packages/domain/src/ledger.ts`): a double-entry, append-only ledger. Balances are always derived by summing postings and never stored.
  - Credits enter only from `system:test-faucet` (`planTopUp`, max `MAX_TOPUP = 10_000` per request).
  - Publishing reserves reward × slots from the builder to the study (`planReserve`; it refuses with "Publishing needs N test credits; you have M").
  - An approval moves the reward from the study to the tester (`planReward`, kind `reward_credit`, or `dispute_credit` after an upheld dispute).
  - Closing returns the unreserved remainder (`planRelease`).
  - The live config shows `testCredits: true`. They are a sandbox currency so the whole flow can be tried without money. Nothing converts them to anything.
- **"USDC" study rewards** (`packages/domain/src/escrow.ts`, `apps/api/src/escrow.ts`, `apps/mobile/src/lib/money.ts`): a separate ledger from credits and from reputation.
  - The builder funds reward × slots plus a fee quoted up front: `quoteEscrow`, fee = `ceil(reward × feeBps / 10000)` per test.
  - Accounts: `vault:<study>` → `payable:<participation>` → `out:tester:<user>`, fee to `fees:platform` on approval, and `refund_pending` → `out:refund:<wallet>` on close.
  - Settlement modes (`apps/api/src/config.ts:241-245`) are only `off`, `simulated` and `squads_devnet`. **A production configuration refuses anything but `off`.** The live site runs the `staging` env with `simulated`, which is why money can be "moved" there at all: no network is touched.
  - Labels are always qualified: `simulated USDC` / "simulation" on hosted, `devnet test USDC` / "devnet pilot, no value" on the pilot (`money.ts:29-35`).
- **Devnet pilot**: Squads v4 2-of-3 multisig vaults on Solana devnet with a test mint. The disclosure reads "Pilot: test keys simulate all roles; not independent custody". Devnet tokens have no value and the mint is not mainnet USDC (row D-xx compares the mint address). Live: `devnetTransfers: false`, so hosted users can't reach it.
- **Reputation** (`packages/domain/src/reputation.ts`): append-only point events, earned only for accepted work. Uploading, submitting, disputing or an honest negative finding never earns or costs points. An upheld fraud finding appends reversals. The leaderboard is opt-in, uses aliases, and ranks by quality (the Wilson lower bound of the acceptance rate over a recency window), never by volume, points or money.

## Plain-language explanation (for testers and builders)
> **Test credits** let you try Pocket QA end to end. Builders add them for free, studies reserve them, and approved testers receive them. They have no cash value and can't be bought, sold or withdrawn.
>
> **USDC rewards** show how a funded study will pay testers once real payments exist. Today they are either a **simulation** (on the website: no money moves) or a **devnet pilot** (Solana test tokens with no value). Pocket QA takes its disclosed fee only on approved tests, never from a tester's reward. Unused rewards and fees go back to the builder when a study closes.
>
> **Reputation points** record accepted work. They are not money, credits or a token, and they can't be traded. Disputes and honest bug reports never lower them.

No exchange rate exists between any of the three, and none is implied.

## Copy that overstates (route + suggested correction)
App money labels are consistently qualified (simulation / devnet, no value). One app line is wrong on hosted:
0. `/sign-up`, builder role note (`apps/mobile/app/(auth)/sign-up.tsx` ROLE_NOTES): "fund them with **local** test credits". On the hosted site the credits are not local. Suggested: "Create studies, fund them with test credits (no cash value), and review testers' evidence." (Found by pqa-ios.)

The overstatements are in the **pitch deck** (`deck/`), as follows:
1. Slide 01: "approved work is paid from a USDC escrow on Solana". On the live site it is simulated, and the only on-chain path is the devnet pilot with valueless test tokens. Suggested: "approved work is paid from a per-study escrow (simulated today, a Solana devnet pilot with test USDC, mainnet after an audit)".
2. Slides 03/04: "rewards locked in the study's escrow", "From the study's escrow, once approved". True of the simulated and devnet ledgers, but say "simulated / devnet" on the slide.
3. Slide 08: "Your wallet is your login: Sign in with Solana through Mobile Wallet Adapter". The live site has `walletLogin: false`. Suggested: "Wallet sign-in (Android, MWA): in the Android build; off on the website".
4. Slide 10: test counts "1,285 app / 575 API / 222 domain" are stale. At `a8ea776` they are 1386 app / 680 (+2 skipped) API / 222 domain / 17 contracts / 83 scripts. Counts are not acceptance evidence on their own.
5. Slide 10: "Three apps in one: tester, builder and admin". Admin exists, but no admin can be granted on the hosted production project (no self-promotion; the grant needs a server-side step). Say "admin (operator-granted)".
