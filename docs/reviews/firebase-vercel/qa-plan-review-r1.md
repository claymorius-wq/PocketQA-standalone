# pqa-qa: Firebase/Firestore + private R2 + Vercel plan review r1

**Plan:** `docs/plans/firebase-vercel-refactor.md` at `d2bfabf` (`feat/firebase-vercel`, from `267cf32`).

**Checked against:**
- my `qa-architecture-test-strategy-r1.md`;
- the SQLite schema `apps/api/src/db.ts` (every `UNIQUE`, enumerated with grep);
- `rateLimit.ts`;
- `config.ts` (R2 deletion policy).

**Method:** read-only. My strategy is adopted, and the transaction purity, deny-all rules, leases, presigned upload and playback, and read-only snapshot migration all match.

## P1
**P1-1: the source of the real Seeker submission lives in a session scratchpad.**
- **The risk:** §8.1 names `scratchpad/nv-api-data/pocketqa.sqlite` as the source. That's a per-session temporary directory. **My own session scratchpad was deleted during this project** (2026-10-05, mid-run, not by me).
- **What's at stake:** the media object is safe in R2 (the parent's receipt), but the submission's **database rows** exist only there: user, participation, evidence metadata, notes, findings and ledger.
- **Required, now, before any refactor work touches it:**
  - take a SQLite online backup into a **durable, non-scratchpad, git-ignored 0700 location**;
  - record its sha256, the `PRAGMA integrity_check` result and the row counts in the plan or receipt;
  - make §8 read from that copy.

## P2
**P2-1: unique guards missing from §2.1.** These `UNIQUE` constraints in `db.ts` have no guard:
- `study_escrows.vault` (`db.ts:262`) and `study_escrows_v7.vault` (`:389`): add `escrowVaults/{vault}`;
- `escrow_fundings.reference` (`:272`) and `.signature` (`:275`): add `fundingReferences/{ref}` and `fundingSignatures/{sig}`;
- `escrow_one_confirmed_funding` (`:282`, one **confirmed** funding per study): add `confirmedFundings/{studyId}`, created when the status becomes `confirmed`;
- `settlements.signature` (`:317`): add `settlementSignatures/{sig}`.

Also:
- **State the partial-index semantics:** `escrow_ledger` uniques apply **only when `amount > 0`** (`:296–300`) and `points_one_award` only for `accepted` and `helpful`. A guard must not block the legitimate negative or reversal entries.
- **Required:** a table mapping **every** `db.ts` UNIQUE (I count 30) to its guard, each with a ≥ 20-way race test.

**P2-2: the idempotency store needs scoping.**
- **The problem:** `idempotency/{scope}:{key}` "stores the first response", but the plan doesn't say what `scope` is.
- **Required:**
  - scope = **authenticated uid + route**, so one user's key can never replay another user's stored response;
  - store a **request fingerprint**, and reject the same key with a different body (422);
  - set a TTL;
  - for routes whose effect is partly outside a transaction (upload complete, presign), document what a replay returns;
  - add tests.

**P2-3: lazy job slices on serverless.**
- **The problem:** "a bounded slice after relevant mutating requests": work started **after** the response is sent can be cut off when the function freezes.
- **Required:**
  - run lazy slices through `waitUntil` (`@vercel/functions`), or inline before responding;
  - since Hobby cron is daily, state the **worst-case latency** for the deletion outbox (privacy: account deletion, discarded evidence) and for intent expiry;
  - add a test that a slice survives the response returning.

**P2-4: the R2 deletion policy contradicts the config and the deletion design.**
- **The contradiction:** §9 sets `POCKETQA_R2_ALLOW_DELETE=0` for production. But `config.ts:196–203` **refuses** R2 without either `ALLOW_DELETE=1` (Hamza's scoped A5 policy) or `RETAIN_NONPROD=1` (synthetic data only). And §3 T7 or §5 says the worker deletes objects.
- **Effect:** production either fails to start, or it holds **real** user evidence with deletion off, which breaks the approved account-deletion semantics.
- **Required:** pick `ALLOW_DELETE=1` with the literal A5 scope (as already approved) and port its tests, or get explicit approval for retention and change the user-facing deletion copy.

**P2-5: the rate limiter is per-instance memory.**
- **The problem:** `rateLimit.ts` keeps hits in a process `Map`. On Vercel, each function instance has its own, so sign-in, upload-intent and wallet-challenge limits become ineffective. That's a security regression from the current single process.
- **Required:** a shared limiter (Firestore token-bucket documents or a Vercel-native control), or a documented accepted risk with compensating controls. Add a test across two app instances.

**P2-6: index coverage isn't gated.**
- **The problem:** the Firestore emulator **doesn't enforce composite indexes**, so a query that needs one passes every emulator test and then fails hosted with `FAILED_PRECONDITION`.
- **Required:**
  - commit `firestore.indexes.json`;
  - add a static test that lists every repository query (filters, order) and asserts a matching index (or that it's a single-field query);
  - run a hosted smoke of each list endpoint in P5.

## P3
1. **Hot-spot account documents.** A single running-total doc (for example the platform or fees account) updated in every approval creates contention and retries. That's fine at pilot scale. State the expected rate, or shard.
2. **Identity link (a).** Link only when the token has `email_verified === true` and the sign-in provider isn't `anonymous` or `custom`. Log the link in `audit`.
3. **Hosted backups.** Firestore PITR and exports may cost money. State the no-backup risk, or ask Hamza (no billing change without approval).
4. **The cron route.** Compare `CRON_SECRET` in constant time. The manual `POST /api/jobs/:job` must be admin-only, and both must be covered by the authz matrix.
5. **Vercel Hobby is non-commercial** (§12.3). Hamza has to decide before real testers use it.

## Gate for the plan
**No P0.**

**Before P1 coding:**
- **P1-1:** the durable snapshot must happen **now**.
- **P2-1:** the guard table must be complete.

**Folded into the plan before the code stage:**
- P2-2, P2-3, P2-4, P2-5 and P2-6.

**P0 work** (repository interfaces plus the sqlite implementation, no behaviour change) can continue in parallel; I'll review it with the full regression.

**Plan verdict:** CHANGES_REQUIRED

## r2: plan at `0f87230` (`0619eb3` plus `0f87230`)
| r1 | Change | My independent check | Status |
|---|---|---|---|
| **P1-1** | A durable online backup at `~/.local/share/pocketqa/backups/20261006T000054Z/` (dir 0700) | `shasum -a 256 pocketqa.sqlite` = `3501bc9e…10e3`, as stated. Opened `immutable=1` (no writes): `integrity_check` **ok**, **31 tables**, users 77, studies 39, participations 30, evidence 11, ledger 154. Seeker evidence row `4aef8a84…` present at **27,178,114 B**. `media/` has 11 files; `shasum -c media.sha256` gives **11 OK**. I printed counts only, no personal data | **fixed** |
| **P2-1** | A 33-row table: every UNIQUE, composite PK and partial index with its exact WHERE → guard doc → 20-way race; plus a static `db.ts` parser test | My own `awk` over `db.ts` lists 32 UNIQUE / composite-PK constraints. **Every one has a row**; the 33rd is the slot counter. The partials are exact (`amount > 0`; `accepted`/`helpful`; open statuses for `one_open_transfer`, with release in the same tx; `alias IS NOT NULL`, released on rename or opt-out). Noted: `escrowVaults` is shared across v6/v7, which is stricter, and fine | **fixed** |
| **P2-2** | Idempotency scope `{uid}:{routeId}:{key}`; sha256 canonical-body fingerprint (422 `IDEMPOTENCY_KEY_REUSED`); 24 h TTL checked on read; semantics for steps outside the tx; tests | Read | **fixed** |
| **P2-3** | Inline bounded slice (≤ 10 items / 300 ms) or `waitUntil`; expiry enforced on read; worst cases stated (deletion ≤ 24 h 59 min without traffic) | Read | **fixed** |
| **P2-4** | `ALLOW_DELETE=1` (literal A5); the worker deletes only the `evidence/` prefix and keys recorded in `storageObjects`; `retained-local-submissions/**` (the Seeker archive) is refused and audited; tests | Read | **fixed** |
| **P2-5** | Firestore fixed-window counters; a two-instance test | Read | **fixed** |
| **P2-6** | `firestore.indexes.json` plus a static query→index coverage test plus a hosted list smoke | Read | **fixed** |
| **P3s** | All addressed. PITR is an accepted risk pending Hamza; Hobby is Hamza's call | Read | ok |

**Team proof:** a live `herdr agent list` (mine, now) shows `pqa-be1` / `pqa-be2` / `pqa-be3` in `wX:p4–p6`, cwd `.worktrees/firebase-vercel`. That matches `team-launch.md`.

**New P3: backup hygiene.**
- **Loose permissions:** in the backup dir, `pocketqa.sqlite-shm`, `-wal` (0 bytes, so the DB file is complete) and `pocketqa.sqlite.sha256` are **0644** while the rest is 0600. The 0700 directory still protects them.
- **Fix:** `chmod 600`.
- **Hardening:**
  - make the snapshot files read-only (`chmod 400`), so no later open can checkpoint into it;
  - open it only with `?immutable=1` or `mode=ro` in the migration tool (the sidecars show it was opened in normal mode once).

**Plan verdict r2:** APPROVE. The code stages (P0–P4) and the hosted stage (P5) each need their own verdicts, as the plan says.
