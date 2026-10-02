# Progress

Build lead: `pocketqa-lead` (Herdr pane `wX:p1`, `claude-opus-5-5`). Newest entries first.

**Team topology (Hamza's decision, 2026-10-02): lead builds solo.** The lead writes all code. `pqa-qa` (pane `wX:p2`, `claude-opus-5-5`) does only read-only independent reviews. No backend, mobile or wallet worker panes, and no per-role worktrees. Why: the auto-mode classifier denied launching children with autonomous permissions. Details are in `docs/reviews/team-launch.md`. Owners in the table below mean the lead in that role's hat, reviewed by `pqa-qa`.

## Status board

| Phase | Owner | State |
|---|---|---|
| 0 Foundation | lead | **APPROVED** by pqa-qa (round 2, plus a targeted re-review of post-approval fixes). No open P0–P2. Initial commit on `main`. P3 follow-ups are carried below. |
| 1 S0 capture spike (real device) | mobile | **blocked:** no physical Android device attached (`adb devices` empty). Emulator evidence will be labeled as emulator. |
| 2 Domain + contracts | lead (backend hat) | **APPROVED** by pqa-qa (r2, plus r3 targeted). Merged to `main`. Domain 156 tests; state machines at 100% branch coverage. |
| 3 Local API | lead (backend hat) | **APPROVED** and merged. 238 API tests: authz matrix, lifecycle, evidence, wallet/devnet (fake RPC), log redaction, config/bind, export/delete. Real-server smoke test on 127.0.0.1. |
| 4 App shell + flows (Gate A) | lead (mobile hat) | **APPROVED** (r1 CHANGES_REQUIRED with a P1 upload race; r2 APPROVE; r3 targeted APPROVE). Merged. Expo SDK 57 app with tester, builder and admin flows; 99 jest tests; 4 Playwright E2E against the real API and a static web export; 23 light/dark screenshots in `docs/reviews/gate-a/`. |
| 5 Android recorder (Gate B1) | mobile | not started |
| 6 Devnet wallet (Gate B2) | wallet | not started |
| 7 Admin/disputes/export/deletion | backend + mobile | API and UI approved and merged. Admin disputes, moderation and audit are E2E-tested. The export and delete UI exists; deletion is tested at API level. |
| 8 Independent QA | qa | not started |

## Carried P3 follow-ups

From Phase 4:
- Tapping Remove on an item already uploading has no visible feedback (one-render window).
- Metro's dev-server watcher doesn't pick up edits in this environment, so acceptance runs use a static `expo export`.


From Phase 2-3:
- Error-mapping test should also assert the log line.
- Account deletion removes the counterparty's demo-transfer history (documented in ADR 0002).
- No admin tool to force a decision on a stuck submission (ADR 0002 limitation).
- 100 MB per-file and 500 MB per-participation caps are untested.
- The API layer was written before its tests. This was disclosed, and mutation checks compensate.

From Phase 0:
- Plan and handoff status lines are stale. **Hamza:** the lead's edit was denied.
- Exact command text for 2 evidence lines; eslint/@eslint/js/typescript rows cite the lockfile.
- Phase 3: redact `/media/` by matched route, not raw string, and add an encoded-path test.
- Scanner policy for devnet explorer URLs and large review media: decide before Gate A and B2 evidence.
- `pqa-qa` read-only limits are enforced by prompt only, because the pane runs in Hamza's default auto mode. **Hamza to acknowledge.**
- Phase 7: builder view of disputes on their own studies.
- Phase 6: SIWS domain vs. MWA app identity URI, from one constant, verified against Solana Mobile docs.

## Log

### 2026-10-02: Phase 4 (Gate A) merged
- The independent review found a real P1: a removed segment could still upload during another in-flight upload on web. Fixed test-first: the uploader works on live state with functional updates. Also fixed: submit blocked while evidence is pending, forbidden state, route role guards, no evidence image cache, explicit evidence link on findings, and uploads cancel on unmount.
- Testing found and fixed: a stale Metro bundle (E2E now uses a static export), stale Discover after a device change, an infinite refetch loop, non-semantic disabled buttons, requests before session restore, and a closed modal lingering on web.

### 2026-10-02: Phase 2-3 merged
- Branch `feat/domain-api` got 3 review rounds from pqa-qa: CHANGES_REQUIRED (3×P2) → APPROVE → APPROVE (targeted).
- Fixes: 7-day dispute window (reject-then-close abuse), deletion PII scrub, copy lint on all builder and admin text, MP4 brand allowlist, upload race re-checks, timing-safe login, token revocation on logout and deletion, finalized commitment, constraint-error mapping, no-echo admin password prompt.

### 2026-10-02 (round 2)
- Fixed every round-1 finding:
  - Moved to Node 24.21.0 LTS (Node 25 EOL 2026-06-01) and vitest 5.0.3.
  - Rewrote the scanner: prefix-insensitive credential rules, env-style values, npm/JWT/bearer/base58 rules, per-line allow, symlink-safe entry, forbidden data/key paths, and real git-repo CLI tests.
  - Hardened `.gitignore`.
  - Contract v0.2.0: server-owned transfer intents, SIWS builder byte-identical to wallet-standard, tester study view, route→auth/schema table, log redaction, withdraw.
  - Rewrote the dependency doc as PARTIALLY VERIFIED, with raw evidence. Added ESLint. Logged verbatim verification.
- The three P3 items I couldn't fix myself are recorded: plan status line (permission denied → Hamza), MWA release-age guard (deferred to Phase 6), user-moderation implementation (Phase 7).

### 2026-10-02 (round 1)
- Herdr context confirmed: `HERDR_ENV=1`, workspace `wX`, pane `wX:p1`, herdr 0.9.1. This supersedes the earlier "HERDR_ENV unset / team not launched" blocker, which applied only to the parent Telegram session. CLAUDE.md corrected. The status lines inside `docs/plans/pocket-qa-execution-plan.md` and `docs/plans/herdr-team-handoff.md` still carry the old "plan only" wording: the lead's edit to them was denied by the permission classifier, so they're left for Hamza. **This file and `docs/verification.md` are the current status.**
- Dependency versions verified against the npm registry and Expo SDK 57 `bundledNativeModules.json` (`docs/decisions/dependency-versions.md`). Notable: React 19.2.3 / RN 0.86.3 (not registry latest), TS ~6.0.3, vitest 4.1.11 because of Node 25.
- Foundation written: root config, `.gitignore`, secret scanner + self-test, `packages/contracts` v0, ADR 0001, README.
- Decision: no in-session advisor tool and no Agent-tool subagents. All delegation goes through Herdr panes running `claude --model claude-opus-5-5` (Hamza: "no hidden advisor/subagent fallback").
