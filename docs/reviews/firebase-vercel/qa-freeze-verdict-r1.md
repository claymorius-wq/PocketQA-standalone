# pqa-qa: Firebase Auth + Firestore + private R2 + Vercel refactor, code-freeze verdict r1

**Candidate:** `feat/firebase-vercel` at `bfdb55a`.
- `bfdb55a` = `492a77f` (which is code `41ceba1` plus docs) + one test-only commit: `PQA_E2E_API_PORT` moves the Playwright API off 8787, and the default is unchanged.
- I checked that no Playwright spec still hardcodes 8787; only the Maestro device scripts do, and those are out of scope.

**Scope of this verdict:** code, local and emulator. **Not** covered:
- provisioning;
- deploy;
- hosted readback;
- the real migration;
- the APK rebuild.

All of those are blocked on cloud access and on billing, which hasn't been verified.

## Gates I ran myself
I ran all of these in detached `.worktrees/qa-fv-run`, with an offline frozen install, on Node 24, using **my** emulator ports (`firebase.emu-qa.json`).

| Gate | Result |
|---|---|
| `pnpm verify` (at `492a77f`; `bfdb55a` adds e2e only) | **EXIT=0**. check:secrets 1110 files, no findings. Scripts 76; contracts 17; domain 222; **API 645 + 2 skipped**; mobile **1362** |
| Every emulator file (`EMU_FILES=test/emulator`), with a fresh `--skip-web` build so the bundle test runs | **27 files, 534 passed, 3 skipped**, EXIT=0. The skips are the 2 SQLite lifecycle-trigger internals and the 1 SQLite-only migration-4 backfill, as stated |
| Staging web build (`build.mjs --env staging`) plus the hosted Playwright smoke under emulators and FakeS3 (`PQA_HOSTED_PORT=8595`) | **2/2**: headers match the shared definitions; zero CSP violations; sign-up → verify → sign-in → tester home. Attempt 1 hit an emulator `BindException` straight after my previous emulator run (infrastructure); the one bounded retry passed |
| Full mobile-web Playwright at `bfdb55a` (`PQA_E2E_API_PORT=18887`) | **28/28**, PW_EXIT=0. The live USB API on 8787 (pid 28574) was **untouched** and still listening afterwards |
| Earlier, at their SHAs | Header and config tests 16/16; build tests 3/3 plus the deploy refusals; idempotency tests (mobile 5/5, API 8/8); bundle test 4/4; and the **migration dry-run manifest reproduced byte-identical** (`686c435d…`) |

## Review summary (all earlier findings)
**Plan review:** P1-1 (durable snapshot) and P2-1 to P2-6 were fixed and checked independently, including the backup sha, `integrity_check`, counts and media hashes.

**Early code reviews:**
| Finding | Fix |
|---|---|
| P2-E (stuck pending idempotency) | `pendingUntil` 5 min ≥ 2 × `maxDuration` 60, with a test |
| P2-F (crash-after-commit) | R12 G/D/N table for all 43 routes; `ctx.idemId`; tests per D route |
| P2-G (fence check) | `fenceInTx` inside the item transaction; serialisability test |
| P2-H (client keys) | Client keys per intent; CORS allows the header |
| P2-I (hosted headers) | One shared header module; bucket-narrowed CSP |
| The P3s | TTL `Timestamp`s, a bounded audit list, cron waiting out a held lease, admins excluded from the email claim, and the deploy build refusing missing server-only values |

**Freeze-time checks:**
- **Staging gets every security rule production has** (`secured = production || staging`): Firebase only, no demo project, no shared demo, wallet login only with the recorded acceptance, the exact public origin, the data dir outside the repo, and no emulator.
- **Client rules:** deny-all.
- **Race tests:** at **N = 20** for nearly every guard row (core, studies, evidence, escrow, settlement, sim transfers, fundings, aliases, wallet links, transfers, points), plus the forced-rerun transaction test.
- **R13 (wallet-first sign-in and Squads stay SQLite-only):** refused at startup. Accepted as a documented limitation.

## Open findings (none blocking)
**P3**
1. **Missing guard-coverage test.** The plan's R2 promised a static test that parses `db.ts` and fails if a UNIQUE constraint lacks a guard row. I found none (`git grep` for a `db.ts` parser in `test/` finds only the backup and ops scripts). Add it, so a future UNIQUE can't ship without a guard.
2. **No rules test.** `firestore.rules` (deny-all) has no `@firebase/rules-unit-testing` test. The content is trivially deny-all and the client never uses the Firestore SDK, but add a small test so an edit can't silently open it.
3. **Thin hosted smoke.** It doesn't yet cover a browser upload (> 4.5 MB) to FakeS3, playback by the owner, or denial for another user. The API-level suites (authz matrix 268, evidence, R2 storage dual-backend) cover the logic. The real proof is the hosted gate (P5).

## Verdict
**APPROVE `bfdb55a`** for the code freeze (local and emulator scope). There are no open P0, P1 or P2 findings.

**Not approved here, still required:**
- cloud access: Firestore enabled, and **billing verified by Hamza**;
- provisioning, deploy, and the hosted gate: cross-user denial; upload > 4.5 MB → HEAD-verified → presigned playback for owner and builder, denial for others; URL expiry; persistence across a redeploy; a cron run; a header readback; the bundle secret scan with **4/4** server-only values checked;
- the **real migration**, then my post-run check: counts = manifest `686c435d`; Seeker playback sha `3ee5d78c…` for the owner and denial for an unrelated tester;
- the HTTPS APK rebuild;
- the merge to main, by Hamza or the parent.

VERDICT: APPROVE

## Addendum: freeze P3-1 and P3-2 at `ef18694` (tests only)
- **Scope:** `git diff --stat bfdb55a ef18694 -- . ':!docs'` touches only `apps/api/test/guard-coverage.test.ts` (new) and `apps/api/test/emulator/rules.test.ts` (new). My copied review files are byte-identical (`cmp`).
- **My runs** (detached `.worktrees/qa-fv-run` at `ef18694`, my emulator ports):
  - `vitest run test/guard-coverage.test.ts`: **32/32**;
  - `rules.test.ts` on the emulator: **20/20**.
- **My own mutations** (both restored; the tree is clean):
  - `firestore.rules` replaced with **allow-all**: rules test **19 failed / 1 passed**, so the test bites;
  - the guard `participationPairs` renamed in `src/repo/studies/firestore.ts`: guard-coverage **1 failed / 31 passed**, so a stale or missing mapping fails.
- **Status:** P3-1 and P3-2 are **fixed**. P3-3 stays in the P5 hosted gate.
- **The APPROVE extends to `ef18694`**, with the same scope and the same outstanding cloud, hosted and migration gates.
