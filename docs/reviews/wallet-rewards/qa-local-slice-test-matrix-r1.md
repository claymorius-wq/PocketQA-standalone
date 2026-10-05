# pqa-qa: wallet-rewards local slice, regression test matrix, r1

**Scope:** the authorised **local** slice: code, tests, UI and an isolated simulation.
- There is no public devnet program, funding, key creation or real custody.
- The provider stays disabled until a verified choice is made (gates B-2 and B-3 in `qa-architecture-threat-review-r1.md`).

**Purpose:** what I'll run or check on the lead's **exact frozen SHA** before giving a local-slice verdict. Each row needs an automated test in the candidate, or a check I perform myself.
- A row I can't confirm is reported as a finding, not assumed.
- Rows are grouped by threat, matching review §3.

**Conventions:**
- "Sim" is the isolated simulated provider or chain adapter.
- All amounts are integer base units (1 USDC = 1,000,000).
- "Ledger invariant" means `funded = available + reserved + disputed + pending_payout + paid + pending_refund + refunded (+ fee held/collected)`, with every bucket ≥ 0.

## A. Scope, honesty and fail-closed (blocking)
| # | Check | Expected |
|---|---|---|
| A1 | `loadConfig` in **production** with wallet payments or the simulator enabled | refused (ConfigError). The feature is off in production by default, and `/config` reports it off |
| A2 | Config refuses a **mainnet** RPC, the mainnet USDC mint (`EPjF…Dt1v`) or a non-devnet genesis, even in development | refused |
| A3 | A real provider adapter is present but **disabled**: no code path signs or submits a real transaction, and the server holds no key material | a static check plus tests: no keypair loading, no `sendTransaction`/`signTransaction` in the server path |
| A4 | Simulator state is **labelled**: the API marks simulated settlement (for example `settlement: 'simulated'`), and the UI shows "Simulation, not an on-chain payment" | screen tests for each state. No "paid" without a "simulated" qualifier, and no chain signature link for a simulated result |
| A5 | Copy check: no "earn", "guaranteed", "paid" (unqualified), "trustless" or "escrow secured" claims in the app source for this feature | a grep test |
| A6 | Existing production refusals are untouched: test top-ups and devnet transfers off; A9 publishing gate; `deleteMe` and the A5 scoped deletion | the existing tests still pass, and the diff doesn't weaken them |
| A7 | The legacy test-credit ledger and the new monetary ledger are **separate**, with no conversion path | schema and test |

## B. Funding (sim) and verification logic
| # | Check | Expected |
|---|---|---|
| B1 | A funding intent is created server-side with the expected mint, vault, amount and a unique reference. The client can't choose the mint, vault or amount | a test with a tampered body gets 400 or is ignored |
| B2 | The verifier rejects the wrong mint (including a Token-2022 look-alike with 6 decimals), the wrong owner program, the wrong vault, an under- or over-payment, `meta.err`, an old block and a non-finalized commitment | unit tests on the pure verifier with fixtures |
| B3 | The verifier uses **pre/post token balance deltas**, not top-level instructions only (a transfer hidden in an inner or CPI instruction; a top-level transfer that the post balance doesn't reflect) | unit tests |
| B4 | The same funding signature, submitted again or for another study, is never credited twice | `UNIQUE(signature)`; test |
| B5 | Publishing only after **confirmed sufficient** funding (reward pool plus disclosed fee) | tests: insufficient funding, or pending verification, blocks publishing |

## C. Reservation and concurrency
| # | Check | Expected |
|---|---|---|
| C1 | N parallel reservations (for example 20) when only k slots or budget remain | exactly k succeed; the rest give a clear conflict; the ledger invariant holds |
| C2 | The reservation check runs **inside** the same write transaction as the insert | code review plus C1 |
| C3 | Reserving needs eligibility and consent, and **snapshots the payout destination** with explicit consent | test |

## D. Payout and replay
| # | Check | Expected |
|---|---|---|
| D1 | Double approval, concurrent approvals or a retried approval request | exactly one payout intent (`UNIQUE(participation_id)`); one sim settlement |
| D2 | A worker crash between "submitted" and "recorded", then a retry | no second settlement; reconciliation reaches the same final state |
| D3 | A duplicate or replayed sim event or webhook after finalisation | ignored, with no ledger change |
| D4 | A failed settlement (sim failure, frozen account, missing token account, underfunded relayer) | the state is `failed`, with a reason. The funds return to `reserved` or `available` per the rules, never shown as paid. A retry is possible without a double pay |
| D5 | A late confirmation after a timeout or "failed" marker | reconciled to the true outcome, with no double count |
| D6 | No payment for uploading bytes alone: payout only after approval or an upheld outcome | test |

## E. Payout wallet substitution
| # | Check | Expected |
|---|---|---|
| E1 | Re-linking a wallet after reservation or approval | the payout still goes to the snapshot. A change needs re-authentication plus a new-wallet signature plus a cooldown plus an audit, and is refused while a payout is authorised or submitted |
| E2 | A forged destination in an approval, payout or admin request body | ignored or refused; tested |
| E3 | Admin dispute resolution can't change the amount or destination | test |

## F. Disputes, refunds and closure
| # | Check | Expected |
|---|---|---|
| F1 | A dispute freezes only that participation's amount (`disputed` bucket) | the invariant holds |
| F2 | A refund in parallel with a dispute resolution, plus a double refund, plus an overturned dispute after closure | no double refund; refunds never consume reserved, disputed or pending amounts |
| F3 | Withdrawal or cancellation with active tasks | the defined behaviour; the invariant holds |
| F4 | A review-inactivity timeout | **never auto-pays unreviewed work**; escalates per the documented rule |
| F5 | Account deletion during an open reservation, dispute or payout | follows the A5 account-deletion scope, with no new retention of recordings. The money state ends consistent (released or `pending_refund`); the invariant holds |

## G. Custody and admin powers (local)
| # | Check | Expected |
|---|---|---|
| G1 | Admin endpoints can decide outcomes only. No endpoint sets amounts or destinations, or triggers arbitrary transfers | route-table review plus tests |
| G2 | Every money transition is audited, with an actor, reason and amounts | test |
| G3 | The trust-model ADR lists every authority (vault, release, refund, fee recipient, upgrade) for the future provider, with "disabled" status now | doc check |

## H. Reputation, badges and leaderboard
| # | Check | Expected |
|---|---|---|
| H1 | Points only from builder-approved participations; `UNIQUE(participation_id, kind)`; a duplicate award is ignored | test |
| H2 | An upheld fraud finding gives an append-only reversal event, with no deletion; the totals recompute | test |
| H3 | Self-dealing (a funding wallet equal to a payout wallet; one wallet on both builder and tester accounts; a builder approving its own alt) is blocked or flagged | tests |
| H4 | The leaderboard is opt-in, with pseudonymous names. The response contains no wallet, email or evidence ids. Minimum sample sizes and a recency window apply. Never ranked by deposit or raw volume | tests, including a scan of the response shape |
| H5 | Honest negative findings and choosing to dispute are not penalised | test |
| H6 | Points have no cash value and are clearly labelled; no token or NFT | copy check |

## I. Ledger invariant and integers
| # | Check | Expected |
|---|---|---|
| I1 | A property or randomised test over sequences of fund, reserve, approve, settle, fail, dispute, resolve, refund and delete | the invariant holds after every step; no negative bucket |
| I2 | No floats in monetary paths: integer base units end to end (DB columns, contracts as integer strings or numbers ≤ 2^53, UI formatting only at the edge) | code check plus a test at the boundaries (1 base unit, large values) |

## J. Standard gates I'll run on the frozen SHA
- **`pnpm verify`** (Node 24), plus **Playwright**, plus the **Firebase emulator E2E**. The screenshots the suites rewrite are restored afterwards.
- **Targeted:** the new API, domain and mobile tests for the rows above, run independently.
- **`check-secrets`,** plus a scan of the evidence for keys or tokens.
- **No live devnet or provider run.** That's out of scope for the local slice. Its absence is noted as a **release gate for live payments**, not a local-slice defect.

**Verdict rule:**
- Any failing row in A, B, C, D, E, F or I is P0–P2, depending on impact.
- G and H rows are P2 when they leak privacy or let someone mint points, otherwise P3.
- A local-slice APPROVE says nothing about readiness for real payments.
