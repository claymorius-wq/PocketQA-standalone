# pqa-qa: Firebase Auth + Firestore, private R2, Vercel refactor. Architecture review and test strategy r1 (pre-plan)

**Base:** `main` `daf0c85`. The lead (`wX:p1`) implements; the plan will be `docs/plans/firebase-vercel-refactor.md`, which doesn't exist yet. I'll re-review against it once written. My worktree is `.worktrees/qa-firebase-vercel` (branch `review/qa-firebase-vercel`, docs only).

**QA limits (mine):**
- no deletions, billing, deploys or writes to the source database;
- I don't read `.env*`, `.preview*`, `preview-data`, `.cloud-local` or credentials;
- hosted checks only on what the parent deploys, using synthetic test accounts.

## Sources (primary)
- **[F1] Firestore transactions**, https://firebase.google.com/docs/firestore/manage-data/transactions:
  - a transaction function "may execute multiple times", so it must not modify application state;
  - reads must come before writes;
  - writes are all-or-nothing;
  - 270 s maximum duration and 60 s idle timeout;
  - batched writes are atomic but can't read.
- **[V1] Vercel Functions limits**, https://vercel.com/docs/functions/limitations:
  - **4.5 MB maximum request or response body** (413 `FUNCTION_PAYLOAD_TOO_LARGE`);
  - maximum duration 300 s (Hobby) or 800 s (Pro);
  - 1,024 file descriptors shared across concurrent executions;
  - no long-running process (cron or workflows instead).
- **[R1] R2 presigned URLs**, https://developers.cloudflare.com/r2/api/s3/presigned-urls/:
  - GET, HEAD, PUT and DELETE only; 1 s to 7 days expiry;
  - **S3 endpoint only, not custom domains**;
  - a signed `Content-Type` is enforced (403 on mismatch);
  - browser use needs bucket CORS;
  - "Treat presigned URLs as bearer tokens".

## What today's design guarantees, and must survive the move
SQLite gives atomic multi-row transactions plus **UNIQUE indexes** as concurrency guards. Firestore has **no unique constraints**, so each of these needs a **deterministic document id created with `create()` (fails if it exists) inside the same transaction**, or a counter document read inside the transaction.

| Today (SQLite) | Invariant | Required Firestore pattern |
|---|---|---|
| `ledger` + `ledger_one_reward` | Credits double-entry; one reward per participation; balance = sum | A per-account balance doc **updated in the same transaction** as an append-only entry doc with a deterministic id (`reward:<participationId>`). Never a client-side aggregate. An `aggregate()` query is not transactional, so it's used only for reconciliation |
| `escrow_ledger` unique funding, authorization, settlement, refund, refund-settled | One of each per study or participation | Deterministic ids per operation (`escrow/<study>/entries/funding`, `settle:<participationId>` and so on) with `create()` in the transaction |
| `settlements_one_payout` / `one_refund` | At most one payout or refund settlement | Same; the settlement doc id = the operation id |
| `escrow_one_confirmed_funding` | One confirmed funding tx | Funding doc id = the chain signature; plus the study's `fundedBy` field set once |
| `points_one_award`, `leaderboard_alias` | One award per source; unique alias | `points/<user>/events/<source>` created once; **alias uniqueness via `aliases/<lowercased>` claim docs** in the transaction |
| `identities_user_provider`, `wallet_links` | One identity per provider and user; a wallet linked to one account | `identities/<provider>:<subject>` claim doc. Wallet link `walletLinks/<address>` created once |
| `upload_intents_one_open_segment` | One open upload per segment | `uploadIntents/<segmentId>` created once; state transitions only |
| `one_open_transfer` (devnet) | One open transfer | Same pattern |
| Study **slots** (participations ≤ slots) | No over-subscription under concurrent consent | A study counter `slotsTaken` read and incremented **in the same transaction** that creates `participations/<study>_<tester>` (that id also enforces one participation per tester and study) |
| `settlements` and `squads_attempts` worker | Exactly-once settlement attempts (the pilot P1 lesson) | **Leases:** `jobs/<id>{leaseOwner, leaseUntil, fencingToken}` acquired transactionally. Every side effect is idempotent by operation id, and a fencing token is checked on write-back. Driven by Vercel Cron, not a resident worker [V1] |
| `sessions`, `playback_tokens` | Server sessions; short playback tokens | Firebase ID-token verification on every request (`verifyIdToken(token, checkRevoked=true)` for sensitive routes); playback = short-TTL presigned GET [R1] issued only after authorization |
| `storage_objects`, `storage_deletions` | Scoped deletion (literal A5) | Same semantics: a deletion-queue collection processed by a leased job |

## Architecture checks (each to a test)
| # | Area | Requirement |
|---|---|---|
| A1 | Transaction purity [F1] | No network, R2, chain or email inside a transaction callback (it can rerun). Side effects happen after commit, keyed by an idempotent operation id. Check by code review plus a lint or grep test |
| A2 | Retry safety | Every mutating endpoint takes an **idempotency key** (or derives one), so a client retry after a timeout never double-credits, double-claims or double-uploads |
| A3 | Server authority | **All writes go through the Vercel API with the Admin SDK.** Client Firestore access is **deny-all by default** in `firestore.rules`; any client read must be narrowly owner-scoped. Rules tested in the emulator with `@firebase/rules-unit-testing` (allow and deny matrices per role). Note: the Admin SDK bypasses rules, so **server authz is the real gate** and needs its own tests |
| A4 | Authz | Role and ownership from server-side user docs, never from client claims alone. Custom claims, if used, need a refresh path after role changes. Cross-user denial on every resource (studies, participations, evidence, findings, ledger, exports) |
| A5 | Indexes | `firestore.indexes.json` committed. Every query in code is covered (the emulator doesn't enforce composite indexes, so hosted verification or an index-coverage test is needed). Collection-group queries are reviewed for leakage |
| A6 | Uploads [V1][R1] | Video bytes **never pass through Vercel**: the API issues a presigned PUT with a signed Content-Type and Content-Length, a per-object key, and a short TTL (minutes). After PUT, the API runs `HEAD` to verify size and type before the evidence becomes visible. Bucket CORS is limited to the app origins. Multipart for files > 5 GB is not needed with the current 500 MB cap |
| A7 | Private playback | Bucket private (no public domain). Playback via presigned GET with a **short TTL**, issued per request after authz. URLs never logged or stored. They're bearer tokens [R1], so the TTL bounds exposure. Downloads `Content-Disposition` safe |
| A8 | Secrets | Firebase Admin credentials, R2 keys and the session secret exist **only** in Vercel server env, never in `EXPO_PUBLIC_*` or the client bundle (the existing bundle secret scan extended to Vercel output). Preview and production envs separated |
| A9 | Migration | A **one-way export from the SQLite source DB (read-only) into Firestore**: idempotent (deterministic ids), dry-run diff, counts and checksums per collection, ledger balances reconciled to the unit, R2 objects re-keyed or kept with a mapping table. **The real Seeker submission must be identified and verified post-migration** (participation, evidence object exists in R2, playable via the new signed GET, owner unchanged). The source DB is never written; rollback = keep the old stack serving until sign-off |
| A10 | Identity | Existing Firebase/email users map to the same Firebase UIDs, and local-auth demo users are handled explicitly. Wallet links preserved. No account merges without proof |
| A11 | Jobs on Vercel | Cron-triggered handlers are idempotent, bounded per run (< `maxDuration`), and lease-protected against overlap (a cron can double-fire). A dead-letter or escalation for stuck jobs |
| A12 | Restrictions kept | Devnet-only money, simulated settlement labelled, shared-demo upload prohibitions, `production` refusing simulated settlement, and no mainnet. All must hold in the new config (port the config tests) |

## Test strategy (what I'll require, and run myself)
1. **Firestore emulator integration suite** (Admin SDK against `FIRESTORE_EMULATOR_HOST`, Auth emulator for tokens), with the current API test suite ported to the new store, not mocks.
2. **Race tests:** `N` concurrent requests (`Promise.all`, at least 20) for:
   - the last study slot (exactly `slots` participations);
   - a double reward / approval (one ledger entry);
   - a double payout or refund settlement (one);
   - alias claim (one winner);
   - wallet link to two accounts (one);
   - upload-intent duplicate (one);
   - two cron runs racing for a job (one lease holder; the fencing token rejects the stale writer).
   - Plus **retry after a forced commit failure**, where a callback throws once and is retried, showing that no side effect ran twice (A1).
3. **Rules tests:** a deny-by-default matrix for anonymous, a tester, another tester, a builder, another builder and an admin, across every collection.
4. **Server authz matrix:** cross-user GET, POST and DELETE on every route returns 403 or 404, never data.
5. **Upload tests:**
   - a presigned PUT with a wrong Content-Type or Length gives 403;
   - an expired URL gives 403;
   - the API refuses to finalise an object whose HEAD size or type differs;
   - a > 4.5 MB file succeeds **because** it bypasses Vercel.
6. **Migration rehearsal** on a **copy** of a source snapshot (the lead produces the copy; I read only reports and hashes):
   - counts and checksums;
   - ledger balances;
   - the real Seeker submission found and playable;
   - re-running the migration is a no-op.
7. **Full regression:** `pnpm verify`, full Playwright (web), native Jest; plus the native APK still talking to the new API (base URL change).
8. **Hosted verification** (after the parent's deploy, synthetic accounts):
   - cross-user denial;
   - upload → HEAD-verified → playback by the owner and the builder; a non-owner is denied;
   - signed-URL expiry;
   - persistence across a redeploy or cold start;
   - security headers;
   - no secrets in the client bundle;
   - the real Seeker submission visible to its rightful roles only.

## Initial blockers
- **No plan or code yet:** I'll review `docs/plans/firebase-vercel-refactor.md` and the first code commits as soon as they exist.
- **The lead must state:**
  - which Firebase project and environments, and that the emulator is used for all automated tests;
  - how the Seeker submission is located, without me reading production data;
  - who performs the deploy (the parent).
