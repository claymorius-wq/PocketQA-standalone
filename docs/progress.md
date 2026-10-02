# Progress

Build lead: `pocketqa-lead` (Herdr pane `wX:p1`, `claude-opus-5-5`). Newest entries first.

**Team topology (Hamza's decision, 2026-10-02): lead builds solo.** The lead writes all code. `pqa-qa` (pane `wX:p2`, `claude-opus-5-5`) does only read-only independent reviews. No backend, mobile or wallet worker panes, and no per-role worktrees. Why: the auto-mode classifier denied launching children with autonomous permissions. Details are in `docs/reviews/team-launch.md`. Owners in the table below mean the lead in that role's hat, reviewed by `pqa-qa`.

## Status board

| Phase | Owner | State |
|---|---|---|
| 0 Foundation | lead | **APPROVED** by pqa-qa (round 2, plus a targeted re-review of post-approval fixes). No open P0–P2. Initial commit on `main`. P3 follow-ups are carried below. |
| 1 S0 capture spike (real device) | mobile | **blocked:** no physical Android device attached (`adb devices` empty). Emulator evidence will be labeled as emulator. |
| 2 Domain + contracts | backend | not started |
| 3 Local API | backend | not started |
| 4 App shell + flows (Gate A) | mobile | not started |
| 5 Android recorder (Gate B1) | mobile | not started |
| 6 Devnet wallet (Gate B2) | wallet | not started |
| 7 Admin/disputes/export/deletion | backend + mobile | not started |
| 8 Independent QA | qa | not started |

## Carried P3 follow-ups (from the Phase 0 reviews)
- Plan and handoff status lines are stale. **Hamza:** the lead's edit was denied.
- Exact command text for 2 evidence lines; eslint/@eslint/js/typescript rows cite the lockfile.
- Phase 3: redact `/media/` by matched route, not raw string, and add an encoded-path test.
- Scanner policy for devnet explorer URLs and large review media: decide before Gate A and B2 evidence.
- `pqa-qa` read-only limits are enforced by prompt only, because the pane runs in Hamza's default auto mode. **Hamza to acknowledge.**
- Phase 7: builder view of disputes on their own studies.
- Phase 6: SIWS domain vs. MWA app identity URI, from one constant, verified against Solana Mobile docs.

## Log

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
