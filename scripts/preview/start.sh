#!/usr/bin/env bash
# Runs the protected preview: the Pocket QA API on loopback with the isolated preview-data
# database, and the gate server (static app + /api proxy) on loopback. Both stay in this
# process group, so a supervisor can stop them together. Required environment:
#   PREVIEW_PORT          gate port (public tunnel origin), e.g. 3471
#   PREVIEW_API_PORT      loopback API port, e.g. 3472
#   PREVIEW_PUBLIC_HOST   e.g. pocketqa.optijara.ai
set -euo pipefail
: "${PREVIEW_PORT:?}" "${PREVIEW_API_PORT:?}" "${PREVIEW_PUBLIC_HOST:?}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
[ -f .preview/gate-secret.json ] || { echo "Run scripts/preview/init-preview.mjs first." >&2; exit 2; }
mkdir -p preview-data && chmod 700 preview-data
[ -f apps/mobile/dist-preview/index.html ] || { echo "Run scripts/preview/build-web.sh first." >&2; exit 2; }

POCKETQA_API_HOST=127.0.0.1 POCKETQA_API_PORT="$PREVIEW_API_PORT" POCKETQA_DATA_DIR="$REPO/preview-data" \
  pnpm --filter @pocket-qa/api start &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$PREVIEW_API_PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PREVIEW_API_PORT/health" >/dev/null || { echo "preview API did not start" >&2; exit 1; }

GATE_FILE="$REPO/.preview/gate-secret.json"
PREVIEW_WEB_ROOT="$REPO/apps/mobile/dist-preview" PREVIEW_SECRET_FILE="$GATE_FILE" node scripts/preview/gate-server.mjs &
GATE_PID=$!
trap 'kill "$GATE_PID" "$API_PID" 2>/dev/null || true' EXIT INT TERM
# bash 3.2 (macOS) has no `wait -n`: exit as soon as either process stops, so the
# supervisor restarts the pair instead of leaving half a preview running.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$GATE_PID" 2>/dev/null; do sleep 2; done
echo "preview process exited" >&2
exit 1
