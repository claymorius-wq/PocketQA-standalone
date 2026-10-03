#!/usr/bin/env bash
# Production static web export for the protected preview. The API base is the same-origin
# relative path `/api` (served by the gate's proxy), so the browser never calls localhost.
set -euo pipefail
cd "$(dirname "$0")/../../apps/mobile"
EXPO_PUBLIC_API_URL=/api NODE_ENV=production npx expo export --platform web --output-dir dist-preview --clear
# Fail if any loopback API origin was baked into the bundle.
if grep -rqE '127\.0\.0\.1:8787|localhost:8787' dist-preview; then
  echo "dist-preview references a loopback API origin; refusing." >&2
  exit 1
fi
echo "web export ready: apps/mobile/dist-preview"
