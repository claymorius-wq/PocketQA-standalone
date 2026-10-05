#!/usr/bin/env bash
# Runs the protected preview: the Pocket QA API on loopback with the isolated preview-data
# database, and the gate server (static app + /api proxy) on loopback. Both stay in this
# process group, so a supervisor can stop them together. Required environment:
#   PREVIEW_PORT          gate port (public tunnel origin), e.g. 3471
#   PREVIEW_API_PORT      loopback API port, e.g. 3472
#   PREVIEW_PUBLIC_HOST   e.g. pocketqa.optijara.ai
# Optional: PREVIEW_STATE_DIR (default .preview), PREVIEW_DATA_DIR (default preview-data),
# PREVIEW_WEB_DIR (default apps/mobile/dist-preview), PREVIEW_SETTLEMENT (simulated, the
# default, or off). If $PREVIEW_STATE_DIR/convenience.json
# exists, the shared-demo convenience (gate prefill + demo sign-ins) is on.
set -euo pipefail
: "${PREVIEW_PORT:?}" "${PREVIEW_API_PORT:?}" "${PREVIEW_PUBLIC_HOST:?}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
case "${PREVIEW_STATE_DIR:-.preview}" in
  .preview|.preview-test/*) ;;
  *) echo "PREVIEW_STATE_DIR must be .preview or under .preview-test/ (git-ignored)." >&2; exit 2 ;;
esac
case "${PREVIEW_STATE_DIR:-}" in *..*) echo "PREVIEW_STATE_DIR must not contain '..'." >&2; exit 2 ;; esac
# Settlement on the shared demo: the labelled simulation (default) or off. The devnet pilot never
# runs here: its server-held test keys would sign for any visitor (ADR 0007 §10; config refuses it too).
SETTLEMENT="${PREVIEW_SETTLEMENT:-simulated}"
case "$SETTLEMENT" in
  simulated|off) ;;
  *) echo "PREVIEW_SETTLEMENT must be simulated or off (the devnet pilot never runs on the shared demo)." >&2; exit 2 ;;
esac
STATE="$REPO/${PREVIEW_STATE_DIR:-.preview}"
DATA="$REPO/${PREVIEW_DATA_DIR:-preview-data}"
WEB="$REPO/${PREVIEW_WEB_DIR:-apps/mobile/dist-preview}"
[ -f "$STATE/gate-secret.json" ] || { echo "Run scripts/preview/init-preview.mjs first." >&2; exit 2; }
mkdir -p "$DATA" && chmod 700 "$DATA"
[ -f "$WEB/index.html" ] || { echo "Run scripts/preview/build-web.sh first." >&2; exit 2; }

# The shared synthetic demo is pinned to local auth and local storage: the process
# environment overrides any cloud settings in .env.local (ADR 0005), and the settlement mode;
# a pilot key-directory variable is removed from the environment.
env -u POCKETQA_SETTLEMENT_PILOT_KEYS_DIR POCKETQA_SHARED_DEMO=1 POCKETQA_SETTLEMENT="$SETTLEMENT" POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local POCKETQA_WALLET_LOGIN=0 POCKETQA_API_HOST=127.0.0.1 POCKETQA_API_PORT="$PREVIEW_API_PORT" POCKETQA_DATA_DIR="$DATA" \
  pnpm --filter @pocket-qa/api start &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$PREVIEW_API_PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PREVIEW_API_PORT/health" >/dev/null || { echo "preview API did not start" >&2; exit 1; }

GATE_FILE="$STATE/gate-secret.json"
PREVIEW_WEB_ROOT="$WEB" PREVIEW_SECRET_FILE="$GATE_FILE" PREVIEW_CONVENIENCE_FILE="$STATE/convenience.json" \
  node scripts/preview/gate-server.mjs &
GATE_PID=$!
trap 'kill "$GATE_PID" "$API_PID" 2>/dev/null || true' EXIT INT TERM
# bash 3.2 (macOS) has no `wait -n`: exit as soon as either process stops, so the
# supervisor restarts the pair instead of leaving half a preview running.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$GATE_PID" 2>/dev/null; do sleep 2; done
echo "preview process exited" >&2
exit 1
