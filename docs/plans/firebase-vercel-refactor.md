# Firebase Auth + Firestore + private R2 + Vercel: refactor plan

**Status:** plan, written first (Hamza's execute authorisation, relayed by the parent, 2026-10-06). It supersedes the Turso proposal.

| | |
|---|---|
| Branch | `feat/firebase-vercel` in `.worktrees/firebase-vercel`, from `feat/native-voice-recording` @ `267cf32` (native `0aaa89b` plus main `daf0c85` intro and badges) |
| Builder | `pocketqa-lead` (`claude-opus-5-5`) |
| Independent plan and code verification | `pqa-qa` (`wX:p2`), coordinated with the Herdr CLI only. Its pre-plan review is `qa-architecture-test-strategy-r1.md`; every requirement in it is adopted here. |

**Out of scope:**
- billing upgrades, mainnet or real money, deleting any account, automatic expiry of user data, other buckets, new paid services;
- the Seeker audio-settings feedback (plan-only, `docs/plans/seeker-settings-feedback.md`);
- any mutation of the user's recording or of the source SQLite database.

## 0. Hard facts this plan is built on
- **Vercel:** "SQLite needs a local file system … storage is ephemeral with serverless functions" (vercel.com/kb/guide/is-sqlite-supported-in-vercel). Hobby cron is "once per day", with ±59 min precision; Pro allows once per minute (vercel.com/docs/cron-jobs/usage-and-pricing). Function request bodies are capped (~4.5 MB), so video never passes through a function.
- **Firestore:** no unique indexes. Transactions are optimistic and their callbacks can rerun, so no side effects inside them (pqa-qa r1 §1–2).
- **The Admin SDK bypasses security rules,** so server authorisation is the real gate; client rules are deny-all.
- **Current API:** 32 SQLite tables, ~4,200 lines of handlers calling synchronous `better-sqlite3` directly (281 statements), 26 transactions, and two in-process timers (sweep 60 s, settlement 15 s).
- **Project `pocketqa-optijara`:** Auth exists (Identity Platform subtype: an open P1 pending Hamza). Firestore API `SERVICE_DISABLED`. The CLI user login has expired (needs `firebase login --reauth`). The `firebase-adminsdk` service account can't enable services. Billing is unverified (console only). Not blocked by any of this: all automated work runs on the **emulator** (`demo-pocketqa`).

## 1. Architecture
- **Vercel project `pocketqa`** (new, in scope `hamzadiaz-4939s-projects`; no other project touched):
  - static Expo web export at `/`;
  - the API as Vercel Functions under `/api/*`, same origin, so no CORS and no cookie-gated preview.
- **API runtime:** the existing Fastify app gets a serverless entry (`api/index.ts` → `app.ready()` + route), the Node runtime, `maxDuration` within plan limits, and the same handlers. The handlers and the contracts' route table stay; only the data layer under them changes.
- **Identity:** Firebase Auth. The app sends a Firebase ID token; the API verifies it with the Admin SDK (`verifyIdToken`, `checkRevoked`) and maps the uid to a Pocket QA user via `identities/{provider}:{uid}`.
  - Production keeps `POCKETQA_AUTH_MODE=firebase` (an existing config rule).
  - Local and USB testing keep `local` mode on SQLite, unchanged.
- **Data:** Firestore (Native mode, Standard edition), one `(default)` database, in a location chosen by Hamza (proposed `eur3`).
- **Evidence:** the private R2 bucket `pocketqa-evidence`.
  - The client gets an upload intent, then makes a presigned **PUT** directly to R2, signed with Content-Type and Content-Length.
  - The server HEAD-verifies size and type before the evidence becomes visible.
  - Playback uses a short-TTL presigned **GET** on the S3 endpoint (no public or custom domain), issued only after the authorisation check.
- **Jobs:** Vercel Cron calls `/api/jobs/{sweep|settle}`, authenticated with `CRON_SECRET`. Each job takes a Firestore **lease** with a fencing token, works in bounded batches below `maxDuration`, and is idempotent per item.
  - On Hobby (daily cron), the same job also runs **lazily**: a bounded slice after relevant mutating requests (for example, sweeping expired intents for that participation).
  - Settlement on hosted Pocket QA stays **simulated only**. No chain sends from Vercel; the squads/devnet paths stay disabled in hosted config.

## 2. Data layer design (no fake SQL-to-Firestore adapter)
- **A repository per domain** (`repo/users`, `repo/studies`, `repo/participations`, `repo/evidence`, `repo/ledger`, `repo/escrow`, `repo/reputation`, `repo/wallet`, `repo/jobs`) exposes **intent-level operations**, for example `claimSlot(studyId, testerId)` or `awardReward(participationId)`. It does not translate SQL.
- **Two implementations of each repository interface:**
  - `sqlite`: today's SQL moved behind the interface, sync calls wrapped in async, so local mode and all 573 API tests keep running.
  - `firestore`: the Admin SDK, with transactions written for Firestore.
- **Handlers become `async`,** depend only on the repository interfaces, and do side effects (R2, chain, network) **after** the transaction returns.
- **No giant single document:** one document per entity; subcollections only where the parent bounds them (tasks under a study, task notes under a participation).

### 2.1 Collections (document id → fields)
| SQLite table | Firestore | Doc id | Notes |
|---|---|---|---|
| users | `users` | user id (kept) | email lower-cased; `status`; `role`; `device` map |
| (users.email UNIQUE) | `userEmails` | sha256(lower(email)) | created in the same tx as the user (unique guard) |
| identities | `identities` | `${provider}:${subject}` | → userId; one per (user, provider): guard `userProviders/${userId}:${provider}` |
| sessions | — | — | **not migrated**: hosted auth is Firebase ID tokens (local mode keeps its sessions table) |
| studies | `studies` | study id | `slotsUsed` counter (see §3); `status`, `moderation` |
| tasks | `studies/{id}/tasks` | task id | ordered by `ord` |
| participations | `participations` | **`${studyId}_${testerId}`** | deterministic, which enforces UNIQUE(study, tester); keeps the legacy `id` field for references |
| task_notes | `participations/{pid}/notes` | taskId | PK (participation, task) |
| evidence | `evidence` | evidence id (kept) | `objectKey`, `sha256?`, size, mime; guard `evidenceSegments/${pid}:${clientSegmentId}` |
| upload_intents | `uploadIntents` | intent id | guard `openSegments/${pid}:${clientSegmentId}` (one open intent) |
| playback_tokens | — | — | replaced by presigned GET plus server authorisation; no stored bearer token |
| findings, disputes, audit | `findings`, `disputes` (doc id = participationId: UNIQUE), `audit` | | audit is append-only |
| ledger | `ledger` | entry id | guard `ledgerRewards/${participationId}:${kind}` (ledger_one_reward); balances = `accounts/{account}` running totals updated in the same tx |
| wallet_links | `walletLinks/{userId}` + guard `walletAddresses/{address}` | | address UNIQUE |
| wallet_nonces, wallet_login_challenges | `walletNonces/{nonce}`, `walletChallenges/{nonce}` | nonce | single use: `usedAt` set in a tx |
| devnet_transfers | `devnetTransfers` | id | guard `openTransfers/${participationId}`; signature UNIQUE via `transferSignatures/{sig}` |
| storage_objects, storage_deletions | `storageObjects/{keyHash}`, `storageDeletions/{keyHash}` | sha256(objectKey) | deletion outbox, lease-processed |
| study_escrows(_v7), escrow_fundings, escrow_ledger, settlements, sim_chain_transfers, squads_attempts | same names | ids kept | partial UNIQUEs become deterministic guard docs: `escrowGuards/${kind}:${ref}` (funding, authorization, settlement, refund, refund_settled), `settlementGuards/payout:${pid}`, `settlementGuards/refund:${studyId}`, `simIdempotency/{key}`, `squadsTx/${multisig}:${txIndex}` |
| points_events, fraud_findings, points_flags | same | ids kept | guard `pointsAwards/${pid}:${kind}` for accepted and helpful; `reverses_id` UNIQUE → `pointsReversals/{reversedId}` |
| leaderboard_profiles | `leaderboardProfiles/{userId}` | | alias UNIQUE (case-insensitive) → `leaderboardAliases/{lower(alias)}`, moved in the same tx on rename |
| jobs | `jobLeases/{job}` | | `{holder, fence, expiresAt}` |
| idempotency | `idempotency/{scope}:{key}` | | stores the first response for retried mutations |

### 2.2 Unique guards: one pattern
Inside the transaction:
1. `tx.get(guardRef)`;
2. if it exists, return the existing result (idempotent) or `CONFLICT`;
3. otherwise `tx.create(guardRef, {...})` plus the entity write.

`create()` fails if the document exists, which closes the race window. Every guard in §2.1 gets a ≥ 20-way concurrency test on the emulator (pqa-qa r1).

## 3. Transaction mapping and invariants
Each SQLite transaction becomes **one Firestore transaction**:
- all reads first;
- deterministic guard documents;
- no side effects in the callback (it can rerun);
- outputs computed from the documents read.

| # | Today (file) | Invariant kept | Firestore transaction |
|---|---|---|---|
| T1 | studies: publish/fund/close (4) | budget ≥ reward × slots; status machine | read study + builder account; write study + ledger hold + account total |
| T2 | participations: join (claim slot) | **slots never oversold**; one participation per (study, tester) | read study (`slotsUsed < slots`), `create participations/${study}_${tester}`, increment `slotsUsed` |
| T3 | participations: submit / withdraw | status machine; withdraw frees the slot | read participation + study; update; decrement `slotsUsed` on withdraw |
| T4 | evidence: intent create / complete / remove (3) | one open intent per segment; quota; evidence visible only after HEAD verify | intent: guard `openSegments`; complete: the HEAD happens **outside**, then the tx re-reads the intent (status `pending`), creates evidence + `evidenceSegments` guard and closes the intent |
| T5 | studies/admin: approve/reject (decide) | **at most one reward per participation**; ledger balanced | read participation + `ledgerRewards` guard; create the guard + 2 ledger entries + account totals |
| T6 | admin: disputes, moderation (4) | one dispute per participation; audit for every admin action | disputes doc id = participation id; audit append in the same tx |
| T7 | account: delete / export (2) | deletion keeps ledger integrity; R2 deletions go to the outbox | tx marks the user deleted and enqueues `storageDeletions`; the worker deletes objects later (no network in the tx) |
| T8 | wallet / walletLogin (2) | one address per user; nonces single-use | guard docs; `usedAt` set once |
| T9 | escrow / settlement worker / squads adapter (4) | one funding, authorisation, settlement and refund each; idempotent settlement attempts | `escrowGuards` / `settlementGuards`; attempts keyed by `attempt_key`; chain calls outside the tx and recorded by a second tx with fence checks |
| T10 | reputation (2) | one award per (participation, kind); one reversal per event; alias unique | `pointsAwards`, `pointsReversals`, `leaderboardAliases` |
| T11 | adminGrant (1) | an explicit, audited admin grant | tx + audit |
| T12 | db.ts migrate (1) | n/a in Firestore | indexes and rules are deployed, not migrated |

**Credits are simulated test credits only** (`testCredits`); no real funds.

**Idempotency:** every mutating route accepts `Idempotency-Key`, stored in `idempotency/` inside the same transaction as the effect.

## 4. Authorisation: deny by default
- **Firestore rules:** `allow read, write: if false;` everywhere. The client never talks to Firestore; the app talks only to the API.
- **Server:** every handler starts from the authenticated user and calls an explicit policy (`can(user, action, resource)`). There's no default allow.
  - **Tests:** a cross-user matrix of tester A, tester B, builder of the study, another builder, and admin, against every resource route. Evidence playback is allowed only for the owning tester, the study's builder, and admin.
- **Evidence objects:** R2 keys are opaque (`evidence/{studyId}/{participationId}/{uuid}`); the bucket is private; GET URLs live ≤ 5 min and are issued only after policy.

## 5. Scheduled jobs (replacing timers)
- `jobLeases/{job}` holds `{holder, fence, expiresAt}`.
- **Acquire:** a tx that succeeds if expired; it increments `fence`.
- **Item work:** check `fence` in its own tx (a stale holder is rejected).
- **Batches:** bounded (N items or T seconds below `maxDuration`); each item is idempotent.
- **Jobs:**
  - `sweep`: expired upload intents, the storage deletion outbox, expired nonces;
  - `settle`: simulated payouts only.
- **Triggers:**
  - Vercel Cron, daily on Hobby or more often on Pro (`CRON_SECRET` bearer);
  - lazily, a small slice after relevant requests;
  - `POST /api/jobs/:job`, admin-only, for manual runs.
- **Tests:** concurrent acquirers, a fenced-out stale writer, a crash mid-batch, then resume.

## 6. Uploads and playback (no Vercel size limit)
1. `createUploadIntent` (the existing contract): the server checks the participation state, role, MIME allow-list, size ≤ cap, and quota, then returns a presigned PUT with signed `content-type` and `content-length` and a TTL of ≤ 15 min.
2. The client PUTs directly to R2. The native app already does this when the server reports R2 mode (`apps/mobile/src/api/client.ts`).
3. `completeUploadIntent`: the server HEADs the object and checks that size and type match, then a tx creates the evidence. A mismatch or a missing object is rejected, and the object goes to the deletion outbox.
4. Playback: the server checks the policy, then returns a presigned GET (≤ 5 min).

**Tests:** above 4.5 MB (e.g. 30 MB), a wrong type, a wrong length, an expired URL, a replayed intent, cross-user playback denied.

## 7. Identity mapping (without losing tester data)
- **Migrated users keep their ids.** Hosted login is Firebase.
- A migrated user is linked to a Firebase uid only by:
  - (a) first sign-in with a **verified email** equal to the stored email; or
  - (b) an **admin link** script (`identities/firebase:{uid}` → userId), audited, for synthetic `@example.test` accounts that can't verify email.
- No user is created or deleted in Firebase by the migration.
- Local password hashes are **not** migrated to the cloud.

## 8. Migration (non-destructive, rehearsed)
1. **Durable snapshot (done 2026-10-06, pqa-qa plan r1 P1-1):** a SQLite **online backup** from a read-only connection; the live local API kept running.
   - Location: `~/.local/share/pocketqa/backups/20261006T000054Z/` (0700; outside the repo and every session scratchpad; files 0600).
   - `pocketqa.sqlite` sha256 `3501bc9e96436b10b58ba843509ff670dff08354ca61bfdf698429fbede610e3`; `integrity_check` = ok; 31 tables (`manifest.json` holds the per-table counts: 77 users, 39 studies, 30 participations, 11 evidence, 154 ledger rows).
   - The Seeker evidence row `4aef8a84…` is present (screen_recording, video/mp4, 27,178,114 bytes).
   - `media/` copied (not moved; 11 files, `media.sha256`). The Seeker file's sha256 equals the R2 receipt (`3ee5d78c…a73`).
   - The migration reads **only copies of this snapshot**: never the live database (`scratchpad/nv-api-data`, WAL, still serving USB testing), and never this backup in place.
2. **Dry run** against the **emulator**:
   - deterministic doc ids, so it's idempotent;
   - writes a manifest with per-table counts, per-collection counts, relation checks (every reference resolves), ledger reconciliation (sum per account = account total), and checksums of the migrated fields.
3. **Media:** evidence rows point at the local media dir.
   - For hosted, each object is uploaded to R2 under its new key, **copy-not-move**: the local file is untouched, and the SHA-256 is compared after a full GET.
   - The Seeker recording is **already archived** by the parent (receipt `.preview/handoff/seeker-r2-archive-verification.json`: evidence `4aef8a84-4439-4001-89fc-2389a89924a7`, 27,178,114 bytes, sha256 `3ee5d78c…a73`). The migration references or copies that object; it never re-uploads from a mutated source and never deletes.
4. **Real run** against hosted Firestore only after QA approves the dry-run manifest. It's idempotent, so reruns are safe.
5. **Verification without reading content:**
   - counts and relations match the manifest;
   - the Seeker evidence is located **by id and sha256** (from the receipt);
   - playback is checked by downloading through a presigned GET as the owning tester and comparing the **SHA-256** with the receipt, then denied as an unrelated tester. No one views the video.
6. **Rollback:**
   - the local SQLite stack and the archived R2 object are untouched;
   - the hosted Firestore data is in separate collections that can be dropped only with Hamza's approval (never automatic);
   - the native APK for USB keeps pointing at the local API until the hosted one passes.

## 9. Environments and secrets
| Where | Variables (names only) |
|---|---|
| Vercel **server-only** (Production) | `POCKETQA_ENV=production`, `POCKETQA_AUTH_MODE=firebase`, `POCKETQA_FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` (secret), `POCKETQA_STORAGE=r2`, `POCKETQA_R2_ACCOUNT_ID`, `POCKETQA_R2_BUCKET`, `POCKETQA_R2_ACCESS_KEY_ID` (secret), `POCKETQA_R2_SECRET_ACCESS_KEY` (secret), `POCKETQA_R2_ALLOW_DELETE=1` (literal A5, already approved; see r2 §R4), `POCKETQA_PUBLIC_ORIGIN`, `CRON_SECRET` (secret), `POCKETQA_DATA_BACKEND=firestore` |
| Vercel **build-time public** | `EXPO_PUBLIC_POCKETQA_ENV=production`, `EXPO_PUBLIC_API_URL=/api` (web), `EXPO_PUBLIC_FIREBASE_*` web config (public by design: API key, auth domain, project id). **No secrets.** A bundle scan in CI and before deploy fails on any server variable name or key pattern. |
| Emulator (tests) | `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, project `demo-pocketqa` |
| Local / USB | unchanged: SQLite, local auth, local storage |

- **Separation:** Preview deployments get no production secrets, or separate values. Vercel env names are read back with `vercel env ls` (names only).
- **APK for hosted HTTPS:** rebuilt with `EXPO_PUBLIC_API_URL=https://<vercel-domain>/api` and `EXPO_PUBLIC_POCKETQA_ENV=production` (the deployment check refuses http or private hosts). This happens **only after** the hosted endpoint passes its live checks. The USB/local APK stays available.

## 10. Tests and gates (pqa-qa r1, all adopted)
1. Unit (RED → GREEN) for every repository operation and policy.
2. Emulator integration, the full API suite against `firestore`:
   - the same contract tests that pass on `sqlite`, run on both backends;
   - ≥ 20-way races: last slot, double reward, double settlement, alias, wallet link, upload intent, lease plus fencing;
   - a forced-retry test proving no side effects inside transactions;
   - the rules matrix (deny-all) and the authorisation matrix;
   - upload size, type and expiry, including > 4.5 MB.
3. A migration rehearsal on a snapshot copy into the emulator, with the manifest.
4. Full regression: `pnpm verify`, Playwright and the native unit tests.
5. Hosted, after deploy:
   - auth sign-in, create/join study, upload (> 4.5 MB) and playback for the owner;
   - denial for others;
   - persistence across a redeploy (proving durability);
   - the cron job run;
   - readback of the deployment URL, deployment id and env **names**.
6. Independent pqa-qa verdicts at the plan, code and hosted stages. No merge to main without them and Hamza's request.

## 11. Work plan
1. **P0:**
   - the repository interfaces;
   - the `sqlite` implementation;
   - handlers async (no behaviour change);
   - the full regression green on SQLite.
2. **P1:** the `firestore` repositories, guard documents, transactions, emulator tests, rules (deny-all), and the authorisation matrix.
3. **P2:** jobs, leases and cron; uploads (HEAD verify) and presigned GET playback; idempotency.
4. **P3:** the Vercel entry, `vercel.json` (functions, crons, rewrites), the web export, the bundle secret scan, and a preview deployment with no secrets (emulator-free smoke).
5. **P4:** the migration tool, the snapshot, the emulator rehearsal and its manifest. Then QA.
6. **P5** (after Firebase access is restored and the database exists):
   - deploy the rules and indexes;
   - production env setup;
   - deploy;
   - hosted tests;
   - the real migration;
   - the APK for HTTPS.

**Delegation:** Herdr panes on `claude-opus-5-5`, each with disjoint files. pqa-qa reviews independently and doesn't build.

## 12. Blockers (precise)
1. **Firebase CLI login expired.** Hamza runs `firebase login --reauth`, or creates the Firestore database in the console (Native mode, Standard edition, location of his choice; `eur3` proposed).
2. **The open P1 on `pocketqa-optijara`:** the Identity Platform subtype and unverified billing. Hamza must confirm in the console that billing is unchanged, or accept it. No billing upgrade will be made.
3. **Vercel plan:** Hobby is non-commercial and has daily cron. Hamza decides whether a Pro plan is needed (billing, so it needs approval). Until then, deploy to Hobby with daily cron plus the lazy job slices.


---
## Revision r2: pqa-qa plan review r1 (`qa-plan-review-r1.md`, CHANGES_REQUIRED)

### R1 (P1-1): durable migration source
Done. See §8.1. The R2 media was already safe; the rows are now durable too.

### R2 (P2-1): every SQLite UNIQUE → guard → race test
Partial semantics are kept exactly: a guard document is created **only when the SQLite WHERE clause would hold**. For example, an escrow ledger row with `amount > 0`, or a points award of kind `accepted` or `helpful`. The 31 UNIQUE constraints in the current `db.ts`:

| # | SQLite constraint | Partial condition | Firestore guard doc (created with `tx.create`) | Race test (≥ 20-way on the emulator) |
|---|---|---|---|---|
| 1 | users.email UNIQUE | — | `userEmails/{sha256(lower(email))}` | 20 sign-ups, same email |
| 2 | participations UNIQUE(study_id, tester_id) | — | doc id `participations/{study}_{tester}` | 20 joins, same tester |
| 3 | (slots) | `slotsUsed < slots` | counter on `studies/{id}` in the join tx | 20 testers for the last slot |
| 4 | evidence UNIQUE(participation_id, client_segment_id) | — | `evidenceSegments/{pid}:{seg}` | 20 completes, same segment |
| 5 | upload_intents.object_key UNIQUE | — | doc id derived from the object key (`uploadIntents/{sha256(key)}`) | key collision test |
| 6 | upload_intents_one_open_segment (pid, client_segment_id) | — | `openSegments/{pid}:{seg}` | 20 intents, same segment |
| 7 | disputes.participation_id UNIQUE | — | doc id `disputes/{pid}` | 20 opens |
| 8 | ledger_one_reward (participation_id, kind) | — | `ledgerRewards/{pid}:{kind}` | 20 approves |
| 9 | identities PK(provider, subject) | — | doc id `identities/{provider}:{subject}` | 20 first sign-ins, same uid |
| 10 | identities_user_provider (user_id, provider) | — | `userProviders/{userId}:{provider}` | 20 links of different uids to one user |
| 11 | task_notes PK(participation_id, task_id) | — | doc id `participations/{pid}/notes/{taskId}` | last write wins (same as SQLite upsert) |
| 12 | wallet_links.user_id PK | — | doc id `walletLinks/{userId}` | 20 links, one user |
| 13 | wallet_links.address UNIQUE | — | `walletAddresses/{address}` | 20 users, one address |
| 14 | devnet_transfers.signature UNIQUE | signature not null | `transferSignatures/{sig}` | 20 confirms, same signature |
| 15 | one_open_transfer (participation_id) | (index has no WHERE: one row per participation) | doc id `devnetTransfers/{pid}` … same semantics as SQLite | 20 creates |
| 16 | study_escrows.vault UNIQUE | — | `escrowVaults/{vault}` | 20 studies, one vault |
| 17 | study_escrows_v7.vault UNIQUE | — | `escrowVaults/{vault}` (shared with #16: one vault across both versions, which is stricter than today; noted) | as #16 |
| 18 | escrow_fundings.reference UNIQUE | — | `fundingRefs/{reference}` | 20 creates, same reference |
| 19 | escrow_fundings.signature UNIQUE | signature not null | `fundingSignatures/{sig}` | 20 confirms, same signature |
| 20 | escrow_one_confirmed_funding (study_id) | status = 'confirmed' | `escrowGuards/confirmedFunding:{study}` (created only on confirm) | 20 confirms of different fundings |
| 21 | escrow_one_funding (ref) | kind = 'funding' AND amount > 0 | `escrowGuards/funding:{ref}` | 20 |
| 22 | escrow_one_authorization (participation_id) | kind = 'payout_authorized' AND amount > 0 | `escrowGuards/payoutAuthorized:{pid}` | 20 |
| 23 | escrow_one_settlement (participation_id) | kind = 'payout_settled' AND amount > 0 | `escrowGuards/payoutSettled:{pid}` | 20 |
| 24 | escrow_one_refund (study_id) | kind = 'refund_authorized' AND amount > 0 | `escrowGuards/refundAuthorized:{study}` | 20 |
| 25 | escrow_one_refund_settled (study_id) | kind = 'refund_settled' AND amount > 0 | `escrowGuards/refundSettled:{study}` | 20 |
| 26 | settlements_one_payout (participation_id) | kind = 'payout' | `settlementGuards/payout:{pid}` | 20 |
| 27 | settlements_one_refund (study_id) | kind = 'refund' | `settlementGuards/refund:{study}` | 20 |
| 28 | settlements.signature UNIQUE | signature not null | `settlementSignatures/{sig}` | 20 |
| 29 | sim_chain_transfers.idempotency_key UNIQUE | key not null | `simIdempotency/{key}` | 20 |
| 30 | points_one_award (participation_id, kind) | kind IN ('accepted','helpful') | `pointsAwards/{pid}:{kind}` (only for those kinds) | 20 |
| 31 | points_events.reverses_id UNIQUE | not null | `pointsReversals/{reversedId}` | 20 |
| 32 | leaderboard_alias (lower(alias)) | — | `leaderboardAliases/{lower(alias)}`, released in the same tx on a rename or opt-out | 20 claims of one alias |
| 33 | squads_attempts UNIQUE(multisig, tx_index) | — | `squadsTx/{multisig}:{txIndex}` | 20 |

A static test parses `db.ts` and fails if a UNIQUE constraint has no row in this table, so a new constraint can't slip through.

### R3 (P2-2): idempotency
- **Scope:** `idempotency/{uid}:{routeId}:{key}`.
- **Fingerprint:** the request body is canonicalised (sorted keys) and hashed with sha256. The same key with a different fingerprint returns **422 `IDEMPOTENCY_KEY_REUSED`**.
- **TTL:** 24 h. Expired records are swept; the TTL is checked on read, so expiry never relies on the sweep.
- **Semantics:**
  - The record is written in the same transaction as the effect.
  - A retry within the TTL returns the stored status and body.
  - Routes whose effect is partly outside a tx (upload intent: presign after the tx; complete: HEAD before the tx; settlement: chain or sim send after the tx) store the **tx outcome**. Their outside step must itself be idempotent:
    - presign is pure;
    - HEAD is read-only;
    - sim sends are keyed by `simIdempotency`.
- **Tests:** same key and body gives one effect; same key with a different body gives 422; another user with the same key gives a separate scope; a retry after expiry creates a new effect.

### R4 (P2-4): R2 deletes
- Production sets `POCKETQA_R2_ALLOW_DELETE=1` (literal A5, approved), as `config.ts` requires (it refuses r2 without ALLOW_DELETE=1 or RETAIN_NONPROD=1). The T7 deletion worker is otherwise inert.
- **Protection:** the deletion worker deletes **only** keys under the app-created prefix `evidence/` that are recorded in `storageObjects`. Anything else, in particular `retained-local-submissions/**` (the Seeker archive), is refused and audited.
- **Tests:** a refusal outside the prefix; the Seeker key refused.

### R5 (P2-3): jobs on Hobby
- Vercel cuts post-response work, so lazy slices run either **inline** (before responding; bounded to ≤ 10 items or 300 ms) or through `waitUntil` from `@vercel/functions` (bounded by `maxDuration`).
- **Worst case under daily Hobby cron:**
  - upload-intent expiry is **enforced on read**: an expired intent can't complete, whatever the sweep;
  - the deletion outbox: ≤ 24 h + 59 min if no request triggers a slice, otherwise the next relevant request;
  - simulated settlement: the next relevant request (approve or status poll) or the daily run.
- **Test:** with no cron, a request performs the bounded slice. An expired intent is refused before any sweep.

### R6 (P2-5): rate limiting
- `rateLimit.ts`'s per-instance Map is replaced in firestore mode by a **Firestore fixed-window counter** `rateLimits/{bucket}:{window}`, incremented in a tx, with a TTL field.
- Hot keys (wallet-login challenge per IP or address) are low-volume.
- **Test:** two app instances on the same emulator share the limit.

### R7 (P2-6): indexes
- `firestore.indexes.json` is committed.
- A **static query-to-index coverage test** enumerates every repository query (collection, filters, orderBy) and checks a matching composite index exists, because the emulator doesn't enforce them.
- A hosted smoke calls every list endpoint after `firebase deploy --only firestore:indexes`.

### R8 (P3)
- **Hot spots:** account totals are only per user, plus one platform escrow account; volume is test-scale. If needed later, the platform account gets sharded counters (noted, not built).
- **Identity link:** `email_verified` must be true **and** the sign-in provider must be password or Google (not anonymous or custom). Every link is audited.
- **Backup/PITR:** hosted Firestore has no backup configured (PITR or scheduled backups may need billing): an accepted risk until Hamza decides. The migration manifest plus the local snapshot are the recovery basis.
- **CRON_SECRET:** compared in constant time (`timingSafeEqual`). The manual job route is admin-only and is in the authorisation matrix.
- **Hobby:** non-commercial use; this is Hamza's decision (§12.3).
