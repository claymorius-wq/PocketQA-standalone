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
1. **Snapshot:** SQLite **online backup** of the source (read-only on the source; the live local API keeps running) into a new file outside the repo.
   - Source: `scratchpad/nv-api-data/pocketqa.sqlite`, the WAL-mode database used by the USB test API.
   - The migration reads **only the snapshot**.
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
| Vercel **server-only** (Production) | `POCKETQA_ENV=production`, `POCKETQA_AUTH_MODE=firebase`, `POCKETQA_FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` (secret), `POCKETQA_STORAGE=r2`, `POCKETQA_R2_ACCOUNT_ID`, `POCKETQA_R2_BUCKET`, `POCKETQA_R2_ACCESS_KEY_ID` (secret), `POCKETQA_R2_SECRET_ACCESS_KEY` (secret), `POCKETQA_R2_ALLOW_DELETE=0`, `POCKETQA_PUBLIC_ORIGIN`, `CRON_SECRET` (secret), `POCKETQA_DATA_BACKEND=firestore` |
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
