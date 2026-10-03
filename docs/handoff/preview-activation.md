# Protected web preview: activation (pocketqa.optijara.ai)

**Status, 2026-10-03:** implemented and verified on loopback; **not exposed**.
- The project-local parts are done: the gate server, the `/api` proxy, the production web export, isolated synthetic data, the credentials file, and tests plus smoke checks.
- The shared-infrastructure steps below (port registry, tunnel ingress, DNS, tunnel reload) were **not** performed from the build session. Reads of those files were denied, so they're left to the parent's separately authorized deployment tools.
- Decision and threat model: `docs/decisions/0004-protected-preview.md`.

## What runs

| Process | Bind | Purpose |
|---|---|---|
| Pocket QA API (`pnpm --filter @pocket-qa/api start`) | `127.0.0.1:$PREVIEW_API_PORT` | Isolated DB in `preview-data/` (git-ignored, 0700). Loopback only (the config refuses anything else). |
| Gate server (`scripts/preview/gate-server.mjs`) | `127.0.0.1:$PREVIEW_PORT` | The only tunnel origin. Password gate on every path; static app; same-origin `/api/*` proxy to the API. |

`scripts/preview/start.sh` runs both, and exits non-zero if either stops, so the supervisor restarts the pair.

## Local steps (project-local; run from the repo root)

```sh
export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH
# 0. Choose ports: two free ports in 3400-3499. Each must be absent from the preview
#    registry (assignedPort), from fleet tunnel services, and from `lsof -nP -iTCP -sTCP:LISTEN`.
#    Candidates that were free of listeners on 2026-10-03: 3471 (gate) and 3472 (API).
#    Not checked against the registry, which the build session could not read.
export PREVIEW_PORT=3471 PREVIEW_API_PORT=3472 PREVIEW_PUBLIC_HOST=pocketqa.optijara.ai

# 1. Gate secret (one-time). Writes .preview/gate-secret.json and .preview/access.txt, both 0600.
node scripts/preview/init-preview.mjs            # --rotate to replace the password and sign everyone out

# 2. Production web export, with API base "/api" (same-origin; no localhost in the bundle).
scripts/preview/build-web.sh

# 3. Start (persistent: register this as the preview's startCmd)
scripts/preview/start.sh

# 4. Seed synthetic demo data (one-time, into preview-data/). Sign-ins are appended to .preview/access.txt.
PREVIEW_API_PORT=$PREVIEW_API_PORT node scripts/preview/seed-demo.mjs

# 5. Local checks with the public Host header (statuses only; no secrets printed)
PREVIEW_URL=http://127.0.0.1:$PREVIEW_PORT PREVIEW_PUBLIC_HOST=$PREVIEW_PUBLIC_HOST node scripts/preview/smoke.mjs
(cd apps/mobile && PREVIEW_URL=http://localhost:$PREVIEW_PORT node e2e/preview/browser-smoke.mjs)
```

Credentials (the gate password plus demo tester, builder and admin sign-ins) exist **only** in `.preview/access.txt` (mode 0600, git-ignored). Deliver them privately and never paste them into logs or panes.

## External changes for the parent (not done here)

These are taken from the parent's summary of the deployment skill:

1. **Registry** (`~/.hermes/previews/registry.json`): add one entry and keep the existing format and entries unchanged. Fields:
   - `slug`: `pocketqa`
   - `projectPath`: `/Users/hamzadiaz/Projects/pocket-qa`
   - `alias`: `pocketqa.optijara.ai`
   - `assignedPort`: `$PREVIEW_PORT`
   - `startCmd`: `PREVIEW_PORT=… PREVIEW_API_PORT=… PREVIEW_PUBLIC_HOST=pocketqa.optijara.ai scripts/preview/start.sh`
   - `status`, `pid`
2. **Ingress** (`~/.cloudflared/fleet-commander.yml`): add this exact-host rule **before** the final 404 rule. Change nothing else.
   ```yaml
   - hostname: pocketqa.optijara.ai
     service: http://127.0.0.1:<PREVIEW_PORT>
   ```
   Point it at the gate port only, never at the API port.
3. **Validate:** `cloudflared tunnel --config ~/.cloudflared/fleet-commander.yml ingress validate`, then `cloudflared tunnel --config … ingress rule https://pocketqa.optijara.ai/` must match the new rule.
4. **DNS:** `cloudflared tunnel route dns fleet-commander pocketqa.optijara.ai`.
5. **Reload:**
   - Identify the user cloudflared with `pgrep -x cloudflared`, then `ps -o command= -p <pid>`. Restart only the runtime whose command uses the fleet-commander config.
   - Wait for its supervisor to respawn it before starting anything else.
   - Use no sudo and no system launchctl, and restart no other service.

## Public verification (after the external steps)

```sh
dig +short pocketqa.optijara.ai @1.1.1.1 ; dig +short pocketqa.optijara.ai @8.8.8.8
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://pocketqa.optijara.ai/__gate/login   # expect 200 0
curl -sS -o /dev/null -w '%{http_code}\n' https://pocketqa.optijara.ai/api/health                        # expect 401 (gated)
PREVIEW_URL=https://pocketqa.optijara.ai node scripts/preview/smoke.mjs                                    # all checks pass
(cd apps/mobile && PREVIEW_URL=https://pocketqa.optijara.ai node e2e/preview/browser-smoke.mjs)
```

- **Expected identity:** the login page carries `<meta name="pocketqa-preview" content="gate">`.
- **Health:** the API's `/health` is reachable only through the gate, or directly on loopback with `curl http://127.0.0.1:$PREVIEW_API_PORT/health`.

## Shared public demo convenience (2026-10-03; ADR 0004 addendum)

This makes the preview effectively public: the gate password is prefilled, and the demo sign-ins are one click away for each role. It runs against the live state (`.preview/`, `preview-data/`).

**Done by the build session, only after independent review approves (no live process touched):**
- a production web rebuild into `apps/mobile/dist-preview` (built beside it and swapped in);
- the gate password rotated to the requested value via stdin (new salt, hash and cookie key);
- `.preview/convenience.json` (0600) written.

The final result report states when these were done.

**Parent: exact restart requirement.**
1. Restart the managed preview process. This is the pair started by `scripts/preview/start.sh`: gate `127.0.0.1:3422`, API `127.0.0.1:3423`.
   - Use the same environment as before: `PREVIEW_PORT=3422 PREVIEW_API_PORT=3423 PREVIEW_PUBLIC_HOST=pocketqa.optijara.ai`.
   - The `startCmd` doesn't change. `start.sh` picks up `.preview/convenience.json` by itself, and the gate log line ends with `[shared-demo convenience on]`.
   - The gate reads the rotated secret and the convenience file only at start, so the restart is required. Until then, the running gate still uses the old password with no prefill.
2. No tunnel, ingress, DNS or registry change is needed: same ports, same host.
3. Verify (statuses only):
   ```sh
   PREVIEW_EXPECT_CONVENIENCE=1 PREVIEW_URL=http://127.0.0.1:3422 PREVIEW_PUBLIC_HOST=pocketqa.optijara.ai node scripts/preview/smoke.mjs
   PREVIEW_EXPECT_CONVENIENCE=1 PREVIEW_URL=https://pocketqa.optijara.ai node scripts/preview/smoke.mjs
   (cd apps/mobile && PREVIEW_EXPECT_CONVENIENCE=1 PREVIEW_SHOTS_DIR=docs/reviews/preview/convenience PREVIEW_URL=https://pocketqa.optijara.ai node e2e/preview/browser-smoke.mjs)
   ```

**Turning it off:** `node scripts/preview/enable-convenience.mjs --off`, then `node scripts/preview/init-preview.mjs --rotate` for a new random password, then restart.

## Teardown

1. Remove the ingress rule and DNS route, then reload the fleet tunnel as above.
2. Stop `start.sh`.
3. Delete `preview-data/` and `.preview/`.
4. Remove the registry entry.
