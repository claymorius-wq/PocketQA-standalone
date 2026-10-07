# pqa-qa: Firebase/Vercel early code review r1 (core, idempotency, leases, rate limit). Not a freeze verdict

**Read at:** `feat/firebase-vercel` HEAD `eb4d0b7`.
- `apps/api/src/repo/core/firestore.ts` (all of it)
- `apps/api/src/firestore/tx.ts` (`runTx`, `claimGuard`, `TxCtx`)
- `apps/api/src/app.ts:150–185` (the Idempotency-Key middleware)
- plan §R10 and §R11

**Method:** read-only. Nothing run yet; I'll run the emulator suites on my own ports (`firebase.emu-qa.json`) at the freeze.

## What holds
- **Guards:** `claimGuard` (read, then `tx.create`) is the one guard pattern.
- **Composable transactions:** `TxCtx` buffers writes so domains compose without breaking reads-before-writes, and it **throws on a read-after-write**, which avoids silent stale reads.
- **Account deletion (`purgeUserCore`):** one transaction. It frees the old email guard only if the guard is the user's, and reserves the placeholder.
- **Idempotency scope:** uid + route + key, with a canonical body fingerprint, and a 422 on mismatch.
- **Rate limit:** a fixed window, transactional.
- **Lease acquire:** transactional, with a fence increment.

## Findings
**P2-E: a pending idempotency reservation can get stuck for 24 h.**
- **Where:** `beginIdempotency` writes `state:'pending', expiresAt: now + 24 h` (`firestore.ts:184`).
- **The problem:** the reservation is cleared only by `abandonIdempotency` (handler throws) or `completeIdempotency`. These paths leave it `pending` for **24 h**, so every retry with that key gets 409 "still running":
  - a function **timeout or crash** (Vercel kills at `maxDuration`);
  - a **response-contract failure** (`app.ts`: `INTERNAL` is thrown **after** the handler, with neither abandon nor complete);
  - a failed `completeIdempotency` write.
- **Required:**
  - give `pending` its own short lease (for example `pendingUntil = now + maxDuration + margin`), after which a retry may take over;
  - call abandon in a `finally` on any non-completed path;
  - add tests: crash after begin, then retry after the pending lease; contract failure.

**P2-F: R10's safety claim must hold for every mutating route.**
- **The claim:** R10 says a re-run after a crash is safe "because every invariant is guarded". That's true only for routes whose effect has a guard or deterministic-id doc. With P2-E's takeover, an **unguarded create** re-runs.
- **Routes at risk:** study create, finding create, and, above all, **test-credit top-up** (`/me/credits/test-topup`: duplicate credits).
- **Required:**
  - a route table (every non-GET route → its guard doc, or an entity id derived deterministically from the idempotency scope, for example `sha256(scope)`, or "naturally idempotent");
  - a test per unguarded route: the effect commits, `completeIdempotency` is lost, the retry runs, and there's **no duplicate**.

**P2-G: the fence check must happen inside the item's transaction.**
- **The problem:** `leaseValid(job, fence, now)` (`firestore.ts:220`) is a **plain read outside any transaction**. A job that checks it and then writes an item in a separate transaction has a check-then-act race: the lease can be taken over between the check and the commit, and the stale holder's write still lands. That defeats fencing; the plan's §5 says "check fence in its own tx".
- **Required:**
  - a `fenceInTx(t, job, fence)` helper that reads `jobLeases/{job}` inside the **item's** transaction and aborts on a mismatch;
  - use it for every item write;
  - a test: the holder passes the check, a takeover happens, then the stale item transaction **aborts**.
- There are no callers in `src` yet, so this is the moment to fix it.

## P3
1. **TTL fields are numbers.** `expiresAt` in `idempotency`, `rateLimits` and `jobLeases` is stored as a **number**. Firestore TTL policies only act on Timestamp fields, so these docs never auto-expire. Either sweep them (bounded, via the job) or store a `Timestamp` field and configure TTL policies at deploy (P5). The read-side TTL checks stay either way.
2. **Unbounded audit read.** `listAudit` reads all of `audit` unbounded, which is costly later. Paginate, or limit plus cursor.
3. **Headers on replay.** A replay returns status and body only. Confirm that no idempotent route relies on response headers.
4. **Divergence from SQLite (be2 d).** Firestore `purgeUser` adds outbox entries in the purge transaction (SQLite doesn't). That's acceptable as crash-safety, but cover it with a test: a crash between the purge transaction and the immediate delete is completed later by the sweep, and the Seeker prefix is still refused.

## R11 (`POCKETQA_ENV=staging`)
**Assessment:** sensible (production security, plus labelled test credits and simulated settlement only, with the devnet pilot refused).

**Requirements:**
- every place that checks `production` for **security** must also cover `staging`. I'll grep at the freeze for `=== 'production'` and `env.production`;
- `staging` must refuse shared-demo, demo-project, local auth and the R2 test endpoint, as the 12 config tests claim; I'll run them.

## r2: R12 (`aac651d`), `6357aef`, and `b9a788a` (read-only)
| r1 | Change | Status |
|---|---|---|
| **P2-E** | `pendingUntil = now + 5 min` (`IDEMPOTENCY_PENDING_MS`). After that a retry takes over; abandon runs in `finally`; a `Timestamp` `expireAt` lets a TTL policy apply | **fixed in code.** P3 below |
| **P2-F** | **The R12 table:** 43 non-GET routes classed as G (guarded), D (deterministic id) or N (naturally idempotent). **The D mechanism:** `ctx.idemId(purpose)` = `sha256(uid:route:key:purpose)`; repos treat "exists" as "return existing" without re-applying ledger or audit effects. **First D route:** moderateUser is D with a crash-after-commit test (`test/idempotency-retry.test.ts`). **The rest:** the other D rows are assigned (be1, be2, be3) | **the classification is accepted.** The remaining D rows are verified at the freeze, each with a crash-after-commit test |
| **P2-G** | `fenceInTx(t, fs, job, fence, now)` reads the lease **inside** the item transaction and throws on a mismatch or expiry | **fixed in code.** Test at freeze |
| P3 TTL / audit | `expireAt` Timestamps; bounded audit list | fixed |

**New P2-H: the client never sends `Idempotency-Key`.**
- **The finding:** `git grep -i idempotency-key` at HEAD finds it only in `packages/contracts` (the error code). **Neither `apps/mobile/src` nor `apps/mobile/app` sends the header.**
- **Why it matters:** R10 replay and every R12 **D** rule only engage when the header is present. As shipped, a client retry or a double submit hits the handler fresh, and D routes create **duplicates**: a second study, a second finding, a **second test-credit top-up**, a second escrow funding.
- **Required:**
  - the mobile and web API client sends a fresh `Idempotency-Key` per user intent on every non-GET (at least all D and G routes) and **reuses the same key across its own retries** of that intent;
  - jest tests: a key is present; it's stable across a retry; a new intent gets a new key;
  - an emulator or API test: two identical top-ups **without** a header, and a retry with the header (exactly one effect).
- **Alternatively, for D routes only:** the server refuses a non-GET without the header (400), so the protection can't be skipped silently.

**New P3: the pending lease must cover the longest request.** `IDEMPOTENCY_PENDING_MS` (5 min) is **equal to** Vercel's default `maxDuration` (300 s) and **shorter** than Pro's 800 s. If `maxDuration` is ever raised, a long first request could be taken over while still running. Derive it from the configured `maxDuration` plus a margin, or assert in config that `maxDuration < IDEMPOTENCY_PENDING_MS`.

## r3: P2-H at `e53f978`
- **The change:**
  - `api()` adds `Idempotency-Key` on every non-GET (a fresh `expo-crypto` `randomUUID`, 32 hex characters, matching the server's `[A-Za-z0-9_-]{8,128}`);
  - the token-refresh retry resends the same key;
  - `useIntentKey()` keeps one key per unchanged request until `done()`. It's wired into topUp, createStudy, createFinding, moderateStudy, createEscrowFunding and createTransfer;
  - multipart upload carries a key;
  - CORS allows `idempotency-key`.
- **My run** (detached `.worktrees/qa-fv-run` at `e53f978`, offline install): mobile jest `__tests__/idempotency-key.test.ts` **5/5**; API vitest `test/idempotency.test.ts` plus `test/idempotency-retry.test.ts` **8/8**.
- **P2-H: fixed.**
- **The pending-vs-maxDuration P3** is accepted as planned (it'll land with `vercel.json`, which pins `maxDuration` 60 s, with a test that `IDEMPOTENCY_PENDING_MS ≥ 2 × maxDuration`). I'll verify it at the freeze.

## r4: hosted entry `5c9d29d` (early, read-only)
**Read:**
- `apps/api/src/hosted/app.ts` (all of it);
- `scripts/vercel/build.mjs` (headers, routes, crons, function config, secret scan);
- `IDEMPOTENCY_EXEMPT` (`fe91b8a`).

**What holds:**
- **Config refusals:** the hosted config refuses anything but Firestore, Firebase and R2; it refuses the devnet pilot; it requires `CRON_SECRET` of at least 32 characters.
- **The cron route:**
  - GET with a constant-time `Bearer` compare;
  - **404** on any mismatch, so the route isn't advertised;
  - runs under a fenced lease, budgeted at 45 s inside `maxDuration` 60, with a 90 s lease.
- **R5 slices:** they run in `onSend` before the response (≤ 10 items or 300 ms), and only after a 2xx on the listed routes.
- **The build output:**
  - `nodejs24.x` in `fra1`;
  - native modules are external (unused on the hosted path);
  - `/api` → function, then the filesystem, then the SPA fallback;
  - two daily crons;
  - a server-only value scan plus `assert-no-secrets` that refuses any output with a hit.
- **The pending-lease P3:** `MAX_DURATION_S = 60` is read by the build, and the test asserts a 2× margin. **Fixed.**
- **`IDEMPOTENCY_EXEMPT`** (credential and export routes): accepted. Those are N (credentials) or read-like, and an export can exceed the document size limit.

**New P2-I: the hosted web output drops the CSP, Permissions-Policy and COOP that production enforces.**
- **The finding:** `SECURITY_HEADERS` in `build.mjs:70–75` has only `nosniff`, `no-referrer`, `DENY` and `HSTS`. The approved production web server (`scripts/production/web-server.mjs`) also sends:
  - a strict **Content-Security-Policy** (`default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, …);
  - **`permissions-policy: camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=()`** (the approved web-recorder policy);
  - `cross-origin-opener-policy`.
- **Effect:** the hosted origin regresses on XSS and framing defence, and loses the mic and display-capture scoping.
- **Required:**
  - port the same headers (one shared module used by both servers and the build, with a test that compares them);
  - extend the CSP **only** as needed for private R2: `connect-src` for the presigned PUT and `media-src` for the presigned GET to the exact S3 endpoint host (`https://<account>.r2.cloudflarestorage.com`), never a wildcard;
  - the R2 bucket CORS must allow only the Vercel origin (P5).
- **Tests:** a header test on `.vercel/output/config.json`, plus a hosted header readback in P5.

**New P3:**
1. **A daily cron can be skipped.** Lazy slices take the **same** lease (`settle` / `sweep`) as the daily cron. If a slice holds it when the cron fires, the cron run returns `ran:false`, and with Hobby's single daily run that day is skipped. Let the cron wait and retry briefly (for example 3 × 1 s) when the lease is held by a short lazy lease.
2. **The pkill disclosure.** An over-broad `pkill` stopped the **USB local API**, whose database holds the **real Seeker submission rows** (the durable backup protects them). Please run a read-only `PRAGMA integrity_check` on the live database, confirm row counts ≥ the backup manifest, record both, and use PID-scoped stops only from now on (a standing rule).

## r5: `ea0010c`, `c6e594d`, `aaa2222` and `e6aab18`
**P2-I: fixed.**
- **One definition:** `scripts/production/security-headers.mjs` is shared by `web-server.mjs` and `scripts/vercel/config.mjs`. It carries permissions-policy (camera off, mic and display-capture self), COOP, HSTS, `DENY` and `nosniff`.
- **CSPs:** the app CSP equals the front door's, plus **only** `https://<32-hex account>.r2.cloudflarestorage.com/<bucket>/` (validated by regex) for connect, media and img. `/api` gets `default-src 'none'; sandbox` plus `no-store`.
- **My run** (`.worktrees/qa-fv-run` at `e6aab18`): `node --test scripts/vercel-config.test.mjs scripts/production-web-server.test.mjs` passes **16/16**.

**The cron P3: fixed.** It retries every 500 ms for 12 s, with an emulator test.

**pkill follow-up:** recorded in `docs/verification.md` (`e6aab18`). Accepted.

**§7(a) claim of a migrated account (`c6e594d`):** correct in code.
- **Before the claim:** it runs only after the identity checks (not `custom`; `email_verified`; a password or Google provider).
- **In one transaction:** the identity must be unmapped; the email guard must point to a user whose `email` matches **exactly**, whose status isn't deleted, which has `migrated_link === 'verified_email'`, and which has no `firebase` provider guard yet. The identity, the provider guard, clearing the marker and the audit row then commit together.
- **Everything else** still never merges.
- **Data check** (my read-only count of the durable backup, `immutable=1`, no addresses printed): 77 users, **0 admins**, **1** non-synthetic email (a tester); 0 emails with uppercase letters, so Firebase's lower-cased emails match.

**P3s:**
- **Admins:** the migration marks **every** migrated user, whatever its role. If an admin is ever migrated, exclude `role = 'admin'` from `migrated_link` (use the audited admin-link script instead). That's not triggered by today's data.
- **Email case:** add a test that a mixed-case stored email is either normalised at migration or refused.

**Migration dry run (`aaa2222`):**
- **The script:** it checks the snapshot sha before opening it, opens it with `immutable=1` and read-only, and re-hashes afterwards. It makes **no R2 calls**, only a plan. The Seeker evidence is a planned **server-side copy** from the archived key, verified by sha at real-run time; the archive stays unregistered, so the deletion worker can't touch it.
- **To approve the manifest, I'll reproduce it myself:** the dry run on **my** emulator ports (`firebase.emu-qa.json`) from **my own copy** of the durable snapshot, then compare my manifest hash with `f1636f45…e239`.
- **I need from the lead:**
  - where the manifest file is;
  - a copy of the Seeker receipt's non-secret fields (`evidenceId`, `key`, `sha256`, `bytes`) placed **outside** `.preview` (I don't read `.preview*`).

## r6: migration dry-run manifest, independently reproduced: APPROVE (dry run only)
**Candidate:** `10d9362` (`feat/firebase-vercel`), `manifestSha256` `686c435dd8015e214315389e00db4e6c46f4825e43726f376124674d3c1639a7`.

**My run:**
- **Setup:** detached `.worktrees/qa-fv-run` at `10d9362`; **my** emulator ports (`firebase.emu-qa.json`); my private 0700 directory `~/.local/share/pocketqa/qa-repro`.
- **Inputs:**
  - `shasum` of the durable backup = `3501bc9e…10e3`, as expected;
  - copied to `snapshot.sqlite` (`chmod 400`) plus `media/`;
  - the receipt at the default `~/.local/share/pocketqa/migration/seeker-receipt.json`.
- **Command:** the exact one the lead sent: `firebase emulators:exec --only firestore --project demo-pocketqa --config ../../firebase.emu-qa.json "npx tsx scripts/migrate-to-firestore.ts --snapshot … --expect-sha256 3501… --media-dir … --out …/manifest.json"`, **EXIT=0**.

**Output (counts only):**
- **Collections:** `planned` = `found`, with checksums ok, for every collection:

  | Collection | Count |
  |---|---|
  | accounts | 77 |
  | evidence | 11 |
  | evidenceSegments | 11 |
  | evidenceUsage | 11 |
  | ledger | 154 |
  | participationPairs | 30 |
  | participations | 30 |
  | storageObjects | 11 |
  | studies | 39 |
  | tasks | 43 |
  | userEmails | 77 |
  | users | 77 |
  | walletAddresses | 1 |
  | walletLinks | 1 |

- **Relations:** 19 checks, **0 unresolved**.
- **Ledger:** 77 accounts, **0 mismatches**, sum 0, matches the source.
- **Users:** 77/77 `migrated_link`, 0 admins.
- **Evidence:** 10 uploads planned plus **1 server copy**.
- **Seeker:** server-copy; participation ✓, tester ✓, doc → target ✓, target registered ✓, **archive registered false** (so the deletion worker can't touch it), playback ✓.
- **Result:** `ok true`, manifest `686c435d…39a7`.

**Comparison:**
- **`cmp`** with the lead's file: **IDENTICAL** (file sha256 `4b8207ef…178e` = the lead's).
- **Source untouched:** the snapshot sha after the run is still `3501bc9e…`, and no `-wal` or `-shm` appeared.

**Completeness** (my read-only count of every non-empty source table):
- **Migrated:** `evidence 11`, `ledger 154`, `participations 30`, `storage_objects 11`, `studies 39`, `tasks 43`, `users 77`, `wallet_links 1`.
- **Not migrated, by design:** `sessions 106` (hosted uses Firebase ID tokens), `wallet_nonces 1` (ephemeral), `schema_migrations 8` (n/a).
- **Nothing else** in the source has rows (no audit, notes, findings, disputes or escrow rows).
- **Nothing is lost.**

**Cleanup:** I deleted my PII-bearing copy (`snapshot.sqlite`, `media/`) after the run. Only my `manifest.json` (counts and hashes) remains.

**Also run (early, not freeze):** the emulator suites at `6526b25` on my ports. Files `tx-foundation`, `core`, `studies.guards`, `studies.flows`, `escrow.intx`, `escrow.repo`, `evidence.repo`, `hosted` and `bundle` gave **107 passed, 4 skipped (1 file skipped)**, EXIT=0.

**Verdict:** **APPROVE the migration dry-run manifest `686c435d…39a7`.** That isn't an approval of the real run. The real run additionally needs:
- cloud access (Firestore enabled; billing verified by Hamza);
- the deploy gates;
- a post-run verification that hosted counts match this manifest and the Seeker evidence plays with a matching sha for its owner, and is denied to an unrelated tester.

## r7: the bundle test (the 4 skips) run
- **Build:** in `.worktrees/qa-fv-run` at `10d9362`, `POCKETQA_R2_ACCOUNT_ID=<dummy 32 hex> POCKETQA_R2_BUCKET=pqa-test node scripts/vercel/build.mjs --skip-web` printed "built .vercel/output (staging): api.func maxDuration 60s in fra1; 3 files; secret scan clean (**0 server-only values checked**)".
- **Test:** `EMU_CONFIG=../../firebase.emu-qa.json EMU_FILES='test/emulator/bundle.test.ts' pnpm test:emulator` gave **4 passed**, EXIT=0, covering the built artifact behind `node:http`: config, cron auth, JSON body plus token verification, and a JSON 404.
- **The built `config.json`:**
  - app routes carry the strict CSP (bucket-narrowed) and the permissions-policy;
  - `/api` carries `default-src 'none'; sandbox`;
  - two daily crons.
- **Cleanup:** I removed `.vercel/` afterwards.

**New P3: the secret scan checks nothing unless the server-only values are present.** In my run it checked **0 server-only values**, because none were in my environment. The value scan only means something when the deploy build runs with the real server-only env present.
- **Required:** in deploy mode (for example `--deploy` or `VERCEL_ENV` set), make the build **fail** if any of the 4 server-only variables (`FIREBASE_SERVICE_ACCOUNT_JSON`, the R2 key id and secret, `CRON_SECRET`) is missing from the scanning environment, so that "0 values checked" can't pass silently.
- **P5:** record the count of values checked in the deploy evidence.

## r8: the r7 P3 at `7a1390b`
- **Tests:** `node --test scripts/vercel-build.test.mjs` gives **3/3**, including a planted server-only value that makes the scan refuse and delete the output.
- **My checks:**
  - `build.mjs --deploy --skip-web`: **rc=1** (refused);
  - `build.mjs --deploy` with the 4 server-only variables absent: **rc=1** (refused, naming the missing ones).
- **Cleanup:** `.vercel/` removed.
- **Status: fixed.**
- **Noted, not yet verified by me:** the lead reports be1's dual-backend gate `26863bd` passes on Firestore (authz matrix 268/268, lifecycle 9, evidence, account and idempotency suites). I'll run it myself at the freeze, with the escrow and R2 conversions included.
