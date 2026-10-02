# Freeze candidate: Phase 2 (domain), Phase 3 (local API), and the API half of Phases 6–7

- **Branch:** `feat/domain-api`. The work is uncommitted, because commits wait for review. Base: `bc2e02a`.
- **Author:** lead (`wX:p1`), solo-build mode.
- **Reviewer:** `pqa-qa` (read-only).

## Scope

- `packages/domain`:
  - state machines for study, participation and evidence segment;
  - double-entry, append-only test-credit ledger;
  - copy linter;
  - eligibility;
  - devnet transfer verification;
  - SIWS wallet-link verification;
  - a UTF-8 helper that needs no host globals.
- `apps/api`, a Fastify + better-sqlite3 API that covers every route in the contracts table:
  - auth: argon2id, hashed bearer sessions, login rate limit;
  - role and ownership guards;
  - studies, budget and consent;
  - participations, notes and evidence (magic-byte sniffing, caps, freeze after submit);
  - playback tokens and Range media;
  - findings, approve and reject;
  - disputes, moderation and audit;
  - export and delete (ADR 0002);
  - wallet nonce, link and unlink;
  - devnet transfer intents and verification;
  - AI status (`available:false`);
  - log redaction;
  - loopback-only config and data-dir guard.
- `docs/decisions/0002-retention.md`.

## TDD note (honest)

- **Domain:** written test-first. All 8 test files ran red ("Cannot find module") before any implementation existed.
- **API:** the handlers were written **before** their tests, so this layer broke TDD order. To compensate, I ran mutation checks. Each check removes one guard and runs the suite:

| Mutation | Result |
|---|---|
| M3: party check lets anyone in | 11 tests fail |
| M5: never burn nonces | 2 fail |
| M6: skip decision state check | 1 fails |
| M7: drop role guard | 66 fail |
| M8: drop full-study check | 1 fails |
| Remove both evidence-freeze layers | 2 fail |
| Remove both redaction layers | 1 fails |

A single layer of either doubled guard survives on its own, which is expected for defense in depth. Every mutation was reverted, and the suite returned to 228/228.

## Commands run (actual output in `pnpm-verify.txt`)

`pnpm verify` → EXIT=0. Results by package:

| Check | Result |
|---|---|
| check:secrets | 83 files scanned, no findings |
| scanner self-test | 7/7 |
| contracts | 14/14 |
| domain | 153/153, coverage thresholds met (state machines and transfer 100% branches) |
| api | 228/228 across 7 files |

Real-server smoke test, lead, `PORT=8799` with a scratch data dir:

```
GET /health → {"ok":true,"contractVersion":"0.2.0"}
lsof LISTEN → node 127.0.0.1:8799
POST /auth/register (builder) → token; GET /me → user JSON without password fields
GET /ai/status → {"available":false,"provider":null}
Origin https://evil.example → 200, no Access-Control-Allow-Origin header
Origin http://localhost:8081 → 200, acao=http://localhost:8081
server log: 6 request lines; grep for token|bearer|horse → 0 matches
```

Real log lines captured during the redaction check:

```
{"req":{"method":"GET","url":"/media/[redacted]"},"msg":"incoming request"}   (for /media/<token>)
{"req":{"method":"GET","url":"/media/[redacted]"},"msg":"incoming request"}   (for /%6Dedia/<token>, which the router serves with 200)
```

## Known limits

- Devnet RPC is faked in tests. The live devnet path, a real wallet signature and a real transaction will be exercised in Phase 6 or marked blocked.
- The login rate limiter is in-memory and per-process.
- Only the 20-item count cap is tested. The 100 MB per-file limit (multipart `fileSize`) and the 500 MB per-participation byte cap are enforced in code but untested, to keep test run time down.

## Round 2: fixes for `verdict-qa-r1.md`

**P2 fixes.** Each fix was written test-first. In `apps/api/test/review-fixes.test.ts` (8 tests), 7 ran red before the fix. The first already passed once the domain change landed.

- **Finding 1: reject-then-close.**
  - The domain now has `DISPUTE_WINDOW_MS` (7 days), `holdsBudget` and `canOpenDispute`.
  - `closeStudyPlan` refuses while any rejection is inside its window.
  - The study budget counts a rejection as committed only inside the window.
  - `openDispute` is allowed only inside the window, no longer depending on whether the study is closed.
  - Tests: domain, and both API scenarios (during and after the window).
- **Finding 2: deletion PII.**
  - Dispute reason becomes `[deleted]`.
  - Devnet transfers involving the user are deleted.
  - User-targeted audit reasons are redacted.
  - The user's playback tokens are deleted.
  - ADR 0002 is updated, including the findings-retention note and the stuck-submission limitation (P3 #7).
- **Finding 3: banned wording.** `assertCleanCopy` now runs on approve notes, finding titles and descriptions, and dispute resolution notes.

**P3 fixes.**

| # | Fix |
|---|---|
| 4 | Count, byte and duplicate checks are repeated inside the insert transaction. `SQLITE_CONSTRAINT*` maps to 409 `CONFLICT_STATE`. |
| 5 | MP4 accepted only for the listed major brands. A HEIC test is rejected. |
| 6 | Unknown emails verify against a dummy argon2 hash. The failure map is pruned when it exceeds 10k entries. |
| 7 | Studies of suspended builders are hidden from eligibility and refuse consent. The rest is documented as a limitation. |
| 8 | Logout deletes the user's playback tokens (tested). |
| 9 | Transfers are verified at `finalized` commitment (`rpc.ts`, ADR 0001). |
| 10 | The RPC-down test asserts the stored status is still `pending`. The weak `existsSync` assertion is replaced. |
| 11 | `create-admin` reads the password from a no-echo prompt or piped stdin, never from argv or env. Run piped against a scratch dir: "Admin account created.", then a second run gives "An account with that email already exists." with exit=1. |

**Verify:** `pnpm verify` EXIT=0. Secrets: 87 files clean. Scanner 7/7, contracts 14/14, domain 156/156, api 236/236 (8 files). See `pnpm-verify.txt`.

## Round 3: post-approval P3 fixes from `verdict-qa-r2.md`

- **New P3 #1:** only `SQLITE_CONSTRAINT_UNIQUE` and `SQLITE_CONSTRAINT_PRIMARYKEY` map to 409. Trigger and foreign-key failures are now 500 INTERNAL and logged.
  - New test in `lifecycle.test.ts`: an injected `RAISE(ABORT)` trigger on reward insert must give 500.
  - Proven red against the old broad mapping: `Tests 1 failed | 10 passed (11)`. Green after restore: `11 passed (11)`.
- **New P3 #2:** new test covering deletion revoking playback tokens, for both the tester's and the builder's tokens. The vacuous pre-deletion assertion was removed.
- **New P3 #3** (counterparty transfer history deleted on account deletion): carried. It is documented in ADR 0002.
- `pnpm verify` EXIT=0: api 238/238 (see `pnpm-verify.txt`).
