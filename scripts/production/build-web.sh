#!/usr/bin/env bash
# Production static web export (docs/production/acceptance-ledger.md D1, O5).
#   PROD_API_URL   required: `/api` (same-origin proxy, recommended) or an https API origin
#   PROD_WEB_DIR   output, relative to the repo (default apps/mobile/dist-production)
# Refuses the shared-demo preview switch, any loopback or plain-http API, and any bundle
# that contains a loopback API origin or the synthetic demo accounts.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
API="${PROD_API_URL:-}"
if [ -n "${EXPO_PUBLIC_PREVIEW:-}" ]; then
  echo "EXPO_PUBLIC_PREVIEW is set; a production build never includes the demo preview." >&2
  exit 1
fi
node "$REPO/scripts/production/check-url.mjs" api "$API"
OUT_REL="${PROD_WEB_DIR:-apps/mobile/dist-production}"
node "$REPO/scripts/production/check-url.mjs" out "$OUT_REL"
OUT="$REPO/$OUT_REL"
NEXT="$OUT.next"
rm -rf "$NEXT"
(cd "$REPO/apps/mobile" && env -u EXPO_PUBLIC_PREVIEW EXPO_PUBLIC_POCKETQA_ENV=production EXPO_PUBLIC_API_URL="$API" NODE_ENV=production \
  npx expo export --platform web --output-dir "$NEXT" --clear)
if grep -rqE '127\.0\.0\.1:8787|localhost:8787' "$NEXT"; then
  echo "web export references a loopback API origin; refusing." >&2
  exit 1
fi
if grep -rqE 'demo-(tester|builder|admin)@pocketqa\.example' "$NEXT"; then
  echo "web export contains a synthetic demo account; refusing." >&2
  exit 1
fi
node "$REPO/scripts/preview/assert-no-secrets.mjs" "$NEXT"
rm -rf "$OUT.old"
[ -d "$OUT" ] && mv "$OUT" "$OUT.old"
mv "$NEXT" "$OUT"
rm -rf "$OUT.old"
echo "production web export ready: ${OUT#"$REPO"/}"
