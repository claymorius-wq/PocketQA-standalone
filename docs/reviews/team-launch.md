# Herdr team launch record

Recorded by the build lead (`pocketqa-lead`, pane `wX:p1`). Live listings are pasted verbatim, other-workspace rows trimmed.

## Lead context (2026-10-02)

```
HERDR_BIN_PATH=/opt/homebrew/bin/herdr
HERDR_ENV=1
HERDR_PANE_ID=wX:p1
HERDR_TAB_ID=wX:t1
HERDR_WORKSPACE_ID=wX
pwd: /Users/hamzadiaz/Projects/pocket-qa
git user: reshareai <284803537+reshareai@users.noreply.github.com>
2.1.283 (Claude Code)
herdr 0.9.1
```

## CLI help used (herdr 0.9.1)

```
herdr agent commands:
  herdr agent list
  herdr agent get <target>
  herdr agent read <target> [--source visible|recent|recent-unwrapped|detection] [--lines N] [--format text|ansi] [--ansi]
  herdr agent send-keys <target> <key> [key ...]
  herdr agent prompt <target> <text> [--wait] [--until STATUS]... [--timeout MS]
  herdr agent rename <target> <name>|--clear
  herdr agent focus <target>
  herdr agent wait <target> [--until STATUS]... [--timeout MS]
  herdr agent attach <target> [--takeover]
  herdr agent start <name> --kind KIND --pane ID [--timeout MS] [-- <agent-args...>]
  herdr agent explain <target> [--json|--format text|json] [--verbose]
  herdr agent explain --file PATH --agent LABEL [--json|--format text|json] [--verbose]
  targets accept unique agent names and pane ids that currently host agents
  kinds: pi|claude|codex|gemini|cursor|devin|agy|cline|omp|mastracode|opencode|copilot|kimi|kiro|droid|amp|grok|hermes|kilo|qodercli|qwen|letta|maki|muse

herdr worktree commands:
  herdr worktree list [--workspace ID | --cwd PATH] [--trust-repository]
  herdr worktree create [--workspace ID | --cwd PATH] [--branch NAME] [--base REF] [--path PATH] [--label TEXT] [--focus] [--no-focus] [--trust-repository]
  herdr worktree open [--workspace ID | --cwd PATH] (--path PATH | --branch NAME) [--label TEXT] [--focus] [--no-focus] [--trust-repository]
  herdr worktree remove --workspace ID [--force] [--trust-repository]

  herdr pane list [--workspace <workspace_id>]
  herdr pane rename <pane_id> <label>|--clear
  herdr pane read <pane_id> [--source visible|recent|recent-unwrapped] [--lines N] [--format text|ansi] [--ansi]
  herdr pane split [<pane_id>|--pane ID|--current] --direction right|down [--ratio FLOAT] [--cwd PATH] [--env KEY=VALUE] [--right-click herdr|pane] [--focus] [--no-focus]
  herdr pane move <pane_id> --tab <tab_id> --split right|down [--target-pane ID] [--ratio FLOAT] [--focus|--no-focus]
  herdr pane close <pane_id>
  herdr pane wait-output <pane_id> (--match TEXT | --regex PATTERN) [--source visible|recent|recent-unwrapped] [--lines N] [--timeout MS] [--raw]
  herdr pane run <pane_id> <command>

  --fallback-model <model>              Enable automatic fallback to specified
  --model <model>                       Model for the current session. Provide
  --permission-mode <mode>              Permission mode to use for the session
```

## Team topology decision (2026-10-02)

1. The lead tried `herdr agent start qa --kind claude --pane wX:p2 -- --model claude-opus-5-5 --permission-mode auto ...`. The Claude Code auto-mode classifier **denied** it: "[Create Unsafe Agents]". (The name `qa` was also already taken by another project's agent in workspace `wV`.)
2. The lead relaunched without a permission flag, as `pqa-qa`. The child came up showing "auto mode on". That is Hamza's own settings default, not something the lead set. The lead asked Hamza how the team should run.
3. **Hamza chose "Lead builds solo".** The lead writes all code in `wX:p1`, and `pqa-qa` performs read-only reviews only (Read/Grep/Glob, no Bash, no edits). No backend, mobile or wallet worker panes are launched, so the per-role worktrees in handoff §4 are not created.
4. The lead tried to cycle `pqa-qa` out of auto mode with `herdr agent send-keys pqa-qa shift+tab`. It was **denied** ("[Self-Modification]") and not retried. `pqa-qa` therefore still shows auto mode. Every prompt sent to it restricts it to read-only tools in writing, and its verdicts are captured verbatim from its pane.
5. `pqa-qa` currently shows Claude Code's "Teach auto mode about your environment?" dialog. The lead leaves it unanswered because it is a user-settings prompt.

## Live listing (wX rows only), verbatim

```json
{"agent":"claude","agent_session":{"agent":"claude","kind":"id","source":"herdr:claude","value":"da661565-2fad-4309-a2d9-5b39948ce53b"},"agent_status":"working","cwd":"/Users/hamzadiaz/Projects/pocket-qa","focused":false,"foreground_cwd":"/Users/hamzadiaz/Projects/pocket-qa","interactive_ready":true,"name":"pocketqa-lead","pane_id":"wX:p1","revision":2,"state_change_seq":747,"tab_id":"wX:t1","terminal_id":"term_65ce0c5b3e92d32","terminal_title":"◐ Pocket QA implementation","terminal_title_stripped":"Pocket QA implementation","workspace_id":"wX"}
{"agent":"claude","agent_session":{"agent":"claude","kind":"id","source":"herdr:claude","value":"e1acf907-12e5-4809-9d8b-d2e0184d1be2"},"agent_status":"blocked","cwd":"/Users/hamzadiaz/Projects/pocket-qa","focused":false,"foreground_cwd":"/Users/hamzadiaz/Projects/pocket-qa","interactive_ready":true,"name":"pqa-qa","pane_id":"wX:p2","revision":2,"state_change_seq":751,"tab_id":"wX:t1","terminal_id":"term_65ce0e30b5f3433","terminal_title":"✳ Pocket QA Phase 0 foundation review","terminal_title_stripped":"Pocket QA Phase 0 foundation review","workspace_id":"wX"}
```

## pqa-qa launch argv (from the `agent start` response)

```
claude --model claude-opus-5-5 --append-system-prompt "<team rules: no Agent tool/subagents/advisor/other models; role-owned paths only; no remotes/deploys/mainnet; TDD; truthful evidence>"
```

No `--fallback-model` was passed. The banner in pane `wX:p2` reads "Opus 5.5 · Claude Max".

## 2026-10-05: iOS native implementer pane `pqa-ios` (native screen + voice recording)
**Why:** Hamza authorised the native mobile recording build, and the parent asked for iOS in parallel in its own Opus 5.5 pane and worktree, with disjoint ownership.

**Launch:**
- launched by `pocketqa-lead` from inside Herdr (`HERDR_ENV=1`, pane `wX:p1`):
  ```
  herdr pane split --current --direction down --cwd /Users/hamzadiaz/Projects/pocket-qa/.worktrees/native-ios --no-focus   → wX:p3
  herdr agent start pqa-ios --kind claude --pane wX:p3 -- --model claude-opus-5-5          → agent_started pqa-ios idle wX:p3
  ```
- no `--fallback-model`;
- the brief forbids subagents and the advisor tool, and limits it to the files it owns.

**Worktree:** `.worktrees/native-ios`, branch `feat/native-voice-ios`, from `c648dd2`.

**Ownership:**
- the iOS module: `modules/screen-capture/ios/**` and `ios-extension/**`;
- `expo-module.config.json`;
- `apps/mobile/plugins/withBroadcastExtension.js` and its test;
- the iOS entries in `app.json`.

The lead keeps Android, the shared JS and the docs, and integrates.

**Live proof** (`herdr agent list`, workspace `wX`, at 2026-10-05T17:00Z):
```
pocketqa-lead  wX:p1  claude  status=working  cwd=/Users/hamzadiaz/Projects/pocket-qa
pqa-ios  wX:p3  claude  status=working  cwd=/Users/hamzadiaz/Projects/pocket-qa/.worktrees/native-ios
pqa-qa  wX:p2  claude  status=done  cwd=/Users/hamzadiaz/Projects/pocket-qa
```
Pane `wX:p3` scrollback (read with `herdr pane read`) shows the launch line `claude --model claude-opus-5-5` and the banner `Opus 5.5 · Claude Max`; no fallback model.
