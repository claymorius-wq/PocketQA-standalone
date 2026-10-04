#!/usr/bin/env bash
# Production API entry point for the process supervisor (ledger O4). Loads the deployment's
# environment from POCKETQA_ENV_FILE: a file outside the repository, readable by its owner
# only (it holds the R2 key pair and the service-account path), parsed as KEY=VALUE lines.
# Refuses anything looser,
# then execs the API so the supervisor's SIGTERM reaches it directly (clean shutdown).
#   POCKETQA_ENV_FILE=/etc/pocketqa/production.env scripts/production/run-api.sh
#   scripts/production/run-api.sh backup     # one online backup to POCKETQA_BACKUP_DIR
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
FILE="${POCKETQA_ENV_FILE:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "POCKETQA_ENV_FILE must point at the deployment's env file." >&2
  exit 1
fi
REAL="$(cd "$(dirname "$FILE")" && pwd -P)/$(basename "$FILE")"
case "$REAL" in "$REPO"/*) echo "The env file must live outside the repository." >&2; exit 1 ;; esac
MODE="$(stat -f '%Lp' "$REAL" 2>/dev/null || stat -c '%a' "$REAL")"
if [ "$MODE" != "600" ] && [ "$MODE" != "400" ]; then
  echo "The env file must be readable by its owner only (chmod 600); it is $MODE." >&2
  exit 1
fi
# Parsed literally, never executed as shell (inc4 review P3-4): KEY=VALUE lines only, an
# optional pair of surrounding quotes is stripped, and `$`, backticks and spaces stay as-is.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '' | '#'*) continue ;; esac
  key="${line%%=*}"
  if [ "$key" = "$line" ] || ! printf '%s' "$key" | grep -qE '^[A-Z][A-Z0-9_]*$'; then
    echo "The env file has a line that isn't KEY=VALUE; refusing." >&2
    exit 1
  fi
  # Data only (inc4 review P3-3): keys like NODE_OPTIONS, PATH or DYLD_* would change how
  # Node starts, so only the app's own settings and the Admin credential path are accepted.
  if ! printf '%s' "$key" | grep -qE '^(POCKETQA_[A-Z0-9_]+|GOOGLE_APPLICATION_CREDENTIALS)$'; then
    echo "The env file sets $key, which is not a Pocket QA setting; refusing." >&2
    exit 1
  fi
  value="${line#*=}"
  case "$value" in \"*\") value="${value#\"}"; value="${value%\"}" ;; \'*\') value="${value#\'}"; value="${value%\'}" ;; esac
  export "$key=$value"
done < "$REAL"
if [ "${POCKETQA_ENV:-}" != "production" ]; then
  echo "The env file must set POCKETQA_ENV=production." >&2
  exit 1
fi
cd "$REPO/apps/api"
# The workspace's pinned tsx (installed with `pnpm install --frozen-lockfile`).
TSX="$REPO/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "tsx not installed; run pnpm install --frozen-lockfile in $REPO." >&2; exit 1; }
case "${1:-serve}" in
  serve) exec "$TSX" src/server.ts ;;
  backup) exec "$TSX" scripts/backup-db.ts ;;
  *) echo "usage: run-api.sh [serve|backup]" >&2; exit 2 ;;
esac
