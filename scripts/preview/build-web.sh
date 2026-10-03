#!/usr/bin/env bash
# Production static web export for the protected preview. The API base is the same-origin
# relative path `/api` (served by the gate's proxy), so the browser never calls localhost.
# EXPO_PUBLIC_PREVIEW=1 turns on the shared-demo sign-in picker, which fetches demo sign-ins
# from the gate at runtime: no credential is ever compiled into the bundle.
#   PREVIEW_WEB_DIR   output, relative to the repo (default apps/mobile/dist-preview)
# Built beside the target and swapped in, so a running gate never serves a half-built tree.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/${PREVIEW_WEB_DIR:-apps/mobile/dist-preview}"
NEXT="$OUT.next"
rm -rf "$NEXT"
(cd "$REPO/apps/mobile" && EXPO_PUBLIC_API_URL=/api EXPO_PUBLIC_PREVIEW=1 NODE_ENV=production \
  npx expo export --platform web --output-dir "$NEXT" --clear)
# Fail if any loopback API origin was baked into the bundle.
if grep -rqE '127\.0\.0\.1:8787|localhost:8787' "$NEXT"; then
  echo "web export references a loopback API origin; refusing." >&2
  exit 1
fi
# Fail if any generated secret value appears in the bundle (values are never printed).
node "$REPO/scripts/preview/assert-no-secrets.mjs" "$NEXT"
rm -rf "$OUT.old"
[ -d "$OUT" ] && mv "$OUT" "$OUT.old"
mv "$NEXT" "$OUT"
rm -rf "$OUT.old"
echo "web export ready: ${OUT#"$REPO"/}"
