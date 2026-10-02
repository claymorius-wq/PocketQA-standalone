# Pocket QA — Herdr Team Handoff

**Status (2026-10-02): TEAM NOT LAUNCHED.** No Herdr command has been executed. This session ran with `HERDR_ENV` unset. No worktrees, branches, commits, or remotes exist. Nothing has been built or tested. Execution plan: `docs/plans/pocket-qa-execution-plan.md`.

## 1. Gate: must be inside a real Herdr context

Run this from the pane that will act as launcher:
```sh
printenv HERDR_ENV
```
- If it prints nothing, **STOP.** Report "not inside Herdr" to Hamza and do not continue.
- Never `export HERDR_ENV=...` by hand, target a focused pane outside Herdr, or change Herdr or terminal settings to get around this gate. The installed Herdr skill forbids controlling panes outside Herdr.
- Local planning with Claude outside Herdr is allowed. Launching the team is not.

## 2. Discover the CLI; never guess

1. Run `herdr --help`, then `herdr <subcommand> --help` for each subcommand you'll use.
2. Paste the relevant output into `docs/reviews/team-launch.md`. Use only flags and subcommands that appear in that output.
3. Get pane, session, and workspace IDs **only** from a fresh live listing taken right before each action. Never reuse IDs from older docs, previous sessions, or memory. If a listing is stale or ambiguous, list again.
4. Confirm `claude --help` documents the model flag you intend to use. Then launch every role with exactly `--model claude-opus-5-5`. Never pass `--fallback-model`, and never use Codex or other provider routing.

## 3. Prerequisite: reviewed foundation commit

The repo has no initial commit, and git worktrees need a commit to branch from. Before you create any worktree:
1. The planner completes Phase 0 (execution plan §7) in `/Users/hamzadiaz/Projects/pocket-qa`.
2. independent-qa reviews the uncommitted tree. There must be no open P0, P1, or P2 finding.
3. Hamza approves, and the initial commit is made on `main` locally. Nothing is pushed.

Until then, only the planner and independent-qa panes may be launched, and both work on the main checkout.

## 4. Roles (all `claude-opus-5-5`)

| Role | Worktree (after §3) | Branch | Owns (writes) | Must not touch |
|---|---|---|---|---|
| planner | main checkout | `main` (merges only, after approval) | `docs/plans/`, `docs/decisions/`, root configs | app/module source |
| mobile | `../pocket-qa-wt/mobile` | `role/mobile` | `apps/mobile/`, `modules/screen-capture/` | `apps/api/`, wallet code |
| backend | `../pocket-qa-wt/backend` | `role/backend` | `apps/api/`, `packages/domain/`, `packages/contracts/` | `apps/mobile/` |
| wallet | `../pocket-qa-wt/wallet` | `role/wallet` | `apps/mobile/src/wallet/`, `apps/api/src/wallet/`, `apps/api/src/devnet/` | other app/api paths |
| independent-qa | `../pocket-qa-wt/qa` | `role/qa` | `docs/reviews/` only | all source (read-only) |

Create the worktrees from the reviewed foundation commit:
```sh
git worktree add ../pocket-qa-wt/<role> -b role/<role> <foundation-sha>
```

- Ownership rule: if one role needs another role's file changed, that change is requested through the planner. Contract changes (`packages/contracts`) belong to backend and need a planner note.
- Each pane verifies its own `pwd`, `git branch --show-current`, and active model before its first edit, and records them in `docs/reviews/team-launch.md`.

## 5. GitHub / remote actions (none implicit)

- No remote exists. Creating one, pushing, opening PRs, or deploying each needs Hamza's **explicit authorization for that action**.
- Use the `reshareai` account only. Before **every** remote write:
  1. Obtain a scoped `GH_TOKEN` securely, for example from the macOS keychain or a password manager prompt. Never echo it, write it to the repo, or write it to logs.
  2. Verify the account with `GH_TOKEN=… gh api user --jq .login`. The output must be exactly `reshareai`.
  3. Confirm the token's scopes and repo access are the minimum the action needs.
  4. Pass the token per command only.
- Never use `gh auth switch`, never change the global git credential configuration, and never use the ambient `hamzadiaz` identity.
- The default remote is private, and only when the authorized workflow reaches that step.
- Prohibited for this build: cloudflared, tunnels, deployments, store submission, and changes to other projects or services.

## 6. Review checkpoints

1. The owner writes a freeze candidate to `docs/reviews/<phase>/candidate.md`. It lists the branch, SHA, the commands that were actually run, and their output.
2. independent-qa (security + product) and the planner each submit a verdict file. Verdicts are independent. Reviewers don't edit each other's verdicts.
3. The merge waits for **all** verdicts. Any open P0, P1, or P2 blocks it. The owner fixes the finding on the role branch, then reviewers re-review the new SHA.
4. Hamza approves; then the planner merges with `--no-ff` to `main`. Nobody commits directly to `main`.
5. Tests count as passed only if their output is captured in the review folder. Never report that a phase built or passed without that evidence.

## 7. Proof of launch

Claim "team launched" only after a fresh live Herdr listing shows all five role panes running in the expected directories, and each pane has confirmed model `claude-opus-5-5`. Record that output, with secrets redacted, in `docs/reviews/team-launch.md`. If you can't get that proof, report it as not launched.

## 8. Stop conditions

Stop and ask Hamza if any of these happens:
- `HERDR_ENV` is unset.
- The CLI help doesn't match this document.
- The `claude-opus-5-5` model can't be pinned.
- The foundation hasn't been reviewed or committed.
- The token login isn't `reshareai`.
- A step needs mainnet, real money, deployment, or a paid service.
- A dependency version is still unverified at Phase 1.
