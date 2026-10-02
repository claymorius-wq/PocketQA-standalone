# Pocket QA — Execution Plan (canonical)

**Status (2026-10-02): PLAN ONLY.** Nothing has been built. No code, scaffolding, dependency install, build, or test has been run. The repo has **no initial commit**, no branches, no worktrees, and no remote. No Herdr team has been launched. Every command below is an instruction for later, not a record of something that ran.

This file supersedes `docs/plans/pocket-qa-implementation-plan.md`, which is a truncated, noncanonical draft. Team launch rules are in `docs/plans/herdr-team-handoff.md`. Product source: `/Users/hamzadiaz/Projects/app-research/app-research-codex.md` (read-only).

## 1. Product scope (MVP)

Buyer-funded, real-device mobile usability tests, with evidence collected under consent.
- **Builder:** creates studies (tasks, device criteria, test-credit budget), reviews evidence, records findings, and approves or rejects each submission with a reason. Tracks budget.
- **Tester:** discovers studies they're eligible for, consents, performs tasks, records with per-session OS consent, previews and removes segments before upload, then tracks status and reward.
- **Admin:** handles disputes and moderation, and runs data export and deletion.
- **Never:** token farming, guaranteed earnings, fabricated AI analysis, fake payment completion, covert capture, or private-key collection.

## 2. Hard constraints

| Area | Rule |
|---|---|
| Builder model | Claude Code with the exact model `claude-opus-5-5`. No Codex, fallback model, or provider shortcuts without Hamza's written approval. |
| Environment | Local-first only. The API binds to `127.0.0.1`. Devices connect through `adb reverse`. No tunnels, cloudflared, deploys, public previews, or store submissions. |
| Money | Budgets and rewards are integer **test credits** with no cash value. No escrow, custody, smart contracts, real payouts, or paid services. |
| Web3 | Devnet/testnet only. Noncustodial connect and disconnect. Connecting a wallet is not a payment. No mainnet code path. No invented Seeker APIs or hardware attestations. |
| WalletConnect | Excluded unless official, current Solana-native support is verified from primary sources and approved. Never conflate it with MWA. |
| AI | Optional and configurable provider. If none is configured, the UI says "Analysis unavailable". It never shows placeholder findings. |
| Secrets | Secrets go only in gitignored `.env.local`. `pnpm check:secrets` must pass before every commit. Logs never contain auth headers, tokens, passwords, raw emails, or media bytes. |
| UI | Sharp, modern mobile UI. Themes: system (default), light, dark. Contrast at least 4.5:1 for text and 3:1 for non-text UI. Lucide icons only. Touch targets at least 48 dp. Stable `testID`s. |
| Copy | "Reward if approved · Not guaranteed". A banned-phrase linter blocks earnings promises in app copy and in builder-entered text. |
| Git | Remote writes only as `reshareai`, using a scoped `GH_TOKEN` verified before each write. Never use ambient `hamzadiaz` or a global auth switch. Nothing reaches `main` without review. |
| Comments | Document decisions and complex invariants only. |

## 3. Dependency versions — PENDING VERIFICATION

The draft named versions (for example Expo SDK 57, RN 0.86, React 19.2.3, Android SDK 36, Zod v4, `@wallet-ui/react-native-kit`). **None are certified here.** Before Phase 1 writes a manifest, the owner must:
1. Confirm each version against the primary source (official changelog or registry page) and record the URL and retrieval date in `docs/decisions/dependency-versions.md`.
2. Confirm compatibility: Expo SDK ↔ React Native ↔ React ↔ Node minimum ↔ Android compile/target SDK.
3. Confirm Solana Mobile MWA package names and their maintenance status, plus `@solana/kit` APIs, from the Solana Mobile and Anza docs.
4. Confirm that the MediaProjection behavior on Android 14 and 15 (single-app sharing, status-bar stop, secure screens) matches the official Android docs.
5. Pin exact versions in the lockfile. Do not upgrade any major version during the MVP without a decision record.

Until this is done, each version is a candidate (TBD) and `independent-qa` holds a P1 blocker on Phase 1.

## 4. Architecture (decision, subject to Phase 0 review)

- **Monorepo** with pnpm workspaces and strict TypeScript:
  - `packages/domain`: pure business rules and state machines, with no I/O.
  - `packages/contracts`: Zod request/response schemas shared by the API and the app.
  - `apps/api`: Fastify + SQLite, bound to localhost.
  - `apps/mobile`: Expo/React Native app, Android dev build first, plus a web preview.
  - `modules/screen-capture`: local Kotlin Expo module that uses MediaProjection.
- **Platform capability matrix:**
  - Android 10+ dev build: full recording.
  - Android below 10, iOS, and web: recording is shown as "unavailable on this device". Studies can still be browsed, and builder review works.
  - iOS cross-app capture is deferred.
- **Media:** stored on the local filesystem under the API data directory. Served only through short-lived, owner- or role-scoped playback tokens. Never public paths.
- **Auth:** email and password (argon2) sessions for local MVP accounts. Wallet linking is a separate signed-nonce flow (§5.3).

## 5. Contracts

### 5.1 State machines (owner: backend, in `packages/domain`)
- **Study:** `draft → published → paused ↔ published → closed`. Publishing requires `budget ≥ reward × slots` in test credits. When a study closes, unspent budget is released.
- **Participation:** `eligible → consented → in_progress → submitted → approved | rejected → (disputed → resolved)`. Consent records the version and timestamp of the consent text.
- **Evidence segment:** `recorded(local) → kept | removed(local) → uploaded`. A removed segment never leaves the device. The server refuses new evidence once the participation is `submitted`.
- **Review:** approving or rejecting requires a reviewer ID and, for a rejection, a non-empty reason. Approval writes exactly one ledger credit (idempotent per participation).
- **Ledger:** an append-only, integer test-credit ledger. The study budget can never go negative. Balances are derived from the ledger, never stored as an editable field.
- **Devnet transfer:** `pending → confirmed | failed | expired`. Only the server's on-chain verification can set `confirmed`, and it checks the recipient, amount, and cluster. A signature the client reports is a claim until the server verifies it.

### 5.2 API surface (owner: backend, in `packages/contracts`; all JSON validated by Zod)
- `POST /auth/register|login|logout`, `GET /me`
- `GET/POST /studies`, `GET/PATCH /studies/:id`, `POST /studies/:id/publish|pause|close` (builder who owns the study)
- `GET /studies/eligible` (tester), `POST /studies/:id/consent`, `POST /participations/:id/start|submit`
- `POST /participations/:id/evidence` (tester who owns it, before submission), `POST /evidence/:id/playback-token`, `GET /media/:token`
- `POST /participations/:id/findings`, `POST /participations/:id/approve|reject` (study owner)
- `POST /disputes`, `POST /admin/disputes/:id/resolve`, `POST /admin/moderation/:id`, `POST /me/export`, `DELETE /me` (with documented retention exceptions for ledger records)
- `POST /wallet/nonce`, `POST /wallet/link`, `DELETE /wallet`, `POST /devnet/transfers`, `GET /devnet/transfers/:id`
- `GET /ai/status`: returns `{available:false}` when no provider is configured.
- **Errors:** `{code, message}`, where `code` is one of `VALIDATION`, `UNAUTHENTICATED`, `NOT_FOUND`, `FORBIDDEN_ROLE`, `CONFLICT_STATE`, `NONCE_INVALID`, `BUDGET_INSUFFICIENT`, `CHAIN_UNAVAILABLE`. When the requester isn't the owner, the API returns `404` (no existence leak).

### 5.3 Wallet auth (owner: wallet)
- Nonces are server-issued, single-use, bound to the user, and carry domain, network (`solana:devnet`), issued-at, and expiry.
- Accepted only through Sign-In With Solana (SIWS) or a sign-message verification on the server.
- Replay, cross-account use, an expired nonce, or the wrong domain or network each return `NONCE_INVALID`, and nothing gets linked.
- The server refuses chain features unless the RPC genesis hash matches devnet.
- MWA is supported on Android only, and that support must be verified on a real device before anyone claims it.

## 6. Threat model (summary; owner: independent-qa)

| Threat | Control | Pinned test |
|---|---|---|
| IDOR on evidence or media | Owner/role checks; `404` for non-owners; playback tokens scoped and TTL-limited | `api/evidence.authz.test.ts` |
| Removed private segment leaks | Upload queue filters removed segments; server freezes evidence after submission | `mobile/upload-queue.test.ts`, `api/evidence.state.test.ts` |
| Nonce replay or substitution | Single-use, user-bound, expiring nonce | `api/wallet.nonce.test.ts` |
| Fake payment success | Server-side chain verification of recipient, amount, cluster, and expiry | `domain/transfer.verify.test.ts` |
| Covert capture | Recording only after an OS consent prompt each session; persistent indicator; system stop handled | Maestro flow `record-consent.yaml` |
| Earnings or fake-AI claims | Banned-copy linter; AI status gate | `domain/copy.test.ts`, `api/ai.status.test.ts` |
| Secret leakage | Secret scan, log redaction, gitignored env files | `pnpm check:secrets`, `api/log.redact.test.ts` |
| Ledger tampering or double credit | Append-only ledger; idempotent approval | `domain/ledger.test.ts` |

## 7. Phases, owners, acceptance

Roles are defined in the handoff. Every phase ends with a **freeze candidate**: a branch tip that independent-qa and the planner review. Write the test first, watch it fail, implement, then watch it pass. The listed test files are created in their phase; none exist yet.

### Phase 0 — Foundation (owner: planner; before any worktree exists)
- **Deliverables:**
  - `.gitignore`, which covers `.env*`, `node_modules`, build output, and the media data directory
  - `README.md`, with local-only rules
  - `CLAUDE.md` and `docs/`
  - `pnpm-workspace.yaml` and the root `package.json` with scripts: `check:secrets`, `typecheck`, `lint`, `test`
  - a secret-scan script
  - `docs/decisions/0001-architecture.md`
  - `docs/decisions/dependency-versions.md` (verified per §3)
- **Acceptance:**
  - independent-qa reviews the uncommitted tree and returns no open P0, P1, or P2.
  - Hamza approves the **initial commit** on `main`.
  - The worktrees from the handoff are created only after that commit exists.

### Phase 1 — Capture feasibility spike, Gate S0 (owner: mobile)
- A throwaway dev build on a real Android 14+ phone (Seeker if available). It records the app's own screen with MediaProjection.
- Covers consent dialog, single-app versus full-screen choice, the system status-bar stop, a secure screen, and a wallet app switch.
- **Acceptance:** a written report in `docs/reviews/s0-capture-spike.md` with device model, OS version, observed behavior, and screenshots taken with consent. If capture across a wallet switch is unreliable, record the decision to scope it out. Spike code is not merged.

### Phase 2 — Domain + contracts (owner: backend)
- Covers the §5.1 state machines, ledger, copy linter, eligibility matching, transfer verification (a pure function that takes RPC results as input), and the §5.2 Zod schemas.
- **Acceptance:** `pnpm --filter domain test` and `pnpm --filter contracts test` are green, including every invalid-transition test. Typecheck passes with strict mode. Coverage of the domain state machines must be 100% on branches.

### Phase 3 — Local API (owner: backend)
- Fastify bound to `127.0.0.1`, SQLite migrations, auth, role guards, every §5.2 route except wallet and devnet, media storage and playback tokens, log redaction, and `/ai/status`.
- **Acceptance:** `pnpm --filter api test` is green. It must include the authorization matrix (each role × each route × owner or non-owner), the evidence-after-submit refusal, playback token expiry and foreign use, idempotent approval, and a budget that never goes negative. Also prove the API refuses to bind to anything other than localhost.

### Phase 4 — App shell + flows, Gate A (owner: mobile)
- Expo Router app, theme system, Lucide icons, the capability matrix, and the tester flows (discover, consent, tasks, upload or unavailable state, status). Builder flows on web preview: create study, publish, review, findings, approve or reject.
- **All states:** loading, empty, error, offline, unauthorized, unavailable capability, and stopped recording.
- **Acceptance:**
  - `pnpm --filter mobile test` (jest-expo + RNTL) and the contrast test are green.
  - Playwright web-preview run covers the end-to-end builder review loop against the local API.
  - Screenshots of light and dark themes go in `docs/reviews/gate-a/`.

### Phase 5 — Android recorder, Gate B1 (owner: mobile)
- A Kotlin Expo module with a foreground service, segmenting, local preview, segment removal, and handling of the system stop and screen lock.
- **Acceptance:**
  - Module unit tests pass.
  - Maestro flows pass on a real device: `record-consent.yaml`, `remove-segment.yaml`, `system-stop.yaml`.
  - Device evidence is committed to `docs/reviews/gate-b1/`.
  - No recording starts without the OS dialog.

### Phase 6 — Devnet wallet, Gate B2 (owner: wallet)
- MWA connect and disconnect on Android, nonce link (§5.3), an optional devnet demo transfer, and a transaction-state UI labeled "Devnet · no real value".
- **Acceptance:**
  - Nonce and transfer verification tests are green, including replay, cross-account, expired, recipient or amount mismatch, and blockhash expiry.
  - A real-device MWA run with a devnet wallet is documented, with a devnet explorer link.
  - The UI never says "paid" unless the state is `confirmed`.

### Phase 7 — Admin, disputes, export, deletion (owners: backend + mobile)
- **Acceptance:**
  - Dispute lifecycle tests pass.
  - The export contains only the requester's data.
  - Deletion removes media files and personal data, keeps anonymized ledger rows, and the retention exception is documented.
  - Moderation actions are audited.

### Phase 8 — Independent QA, Gate B final (owner: independent-qa)
- A security review against §6, a product and UX review of every state, a native run on Android, and browser runs.
- **Output:** `docs/reviews/final/verdict.md` listing findings with P0–P3 severity and evidence paths.

## 8. Commands (future; none have been run)

```sh
pnpm install --frozen-lockfile
pnpm check:secrets && pnpm typecheck && pnpm lint && pnpm test
pnpm --filter api dev            # binds 127.0.0.1 only
adb reverse tcp:8787 tcp:8787    # device → local API (port TBD in Phase 0)
pnpm --filter mobile web         # web preview
pnpm --filter mobile e2e:web     # Playwright
maestro test apps/mobile/e2e/maestro/
```

## 9. Review and merge protocol

1. The owner tags a freeze candidate on a role branch and lists the commands they ran and their output in `docs/reviews/<phase>/candidate.md`.
2. independent-qa and the planner each write a verdict independently. All verdicts are required. Silence is not approval.
3. Any open P0, P1, or P2 blocks the merge. The owner fixes the finding on the role branch, then re-review happens.
4. Hamza approves; then a `--no-ff` merge to `main` with a conventional commit message. Nobody commits directly to `main`.
5. Push or remote creation happens only with Hamza's explicit authorization **and** after the scoped `reshareai` token is verified (handoff §5).

## 10. Out of scope (separate approval required)

WalletConnect/Reown, mainnet, real payouts and escrow, SGT/Seeker attestation, AI provider adapters beyond the "unavailable" state, iOS cross-app capture, deployment, cloudflared, store submission, and paid services.

## 11. Open items

- Dependency verification (§3): blocking.
- S0 device availability: a Seeker or another Android 14+ phone must be present.
- Local API port and data directory: decided in Phase 0.
- Consent-text versioning and the retention policy wording: need Hamza's review.
