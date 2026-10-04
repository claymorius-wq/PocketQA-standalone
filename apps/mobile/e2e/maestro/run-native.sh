#!/usr/bin/env bash
# Runs every native gate flow against the installed release APK on the attached emulator.
# Each flow gets fresh seed data from the local API (127.0.0.1:8787 via adb reverse).
# Maestro debug output and JUnit reports stay inside the workspace (git-ignored .results/).
# Usage: WALLET_PIN=<test AVD pin> ./run-native.sh [flow ...]
set -u
cd "$(dirname "$0")"
FLOWDIR="$PWD"
OUT="$PWD/.results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
FLOWS=("$@")
[ $# -gt 0 ] || FLOWS=(record-consent record-decline notifications-denied remove-segment system-stop notification-stop leave-while-recording wallet-decline wallet-link devnet-transfer-unfunded sheet-keyboard sign-out)
adb reverse tcp:8787 tcp:8787 >/dev/null
status=0
for f in "${FLOWS[@]}"; do
  if [ "$f" = devnet-transfer-unfunded ]; then seed=seed-transfer.mjs; else seed=seed.mjs; fi
  eval "$(node "$seed" | sed 's/^/export /')"
  mkdir -p "$OUT/$f"
  # takeScreenshot writes into the current directory, so run from the flow's result dir.
  (cd "$OUT/$f" && maestro test --debug-output="$OUT/$f" --flatten-debug-output --format=JUNIT --output="$OUT/$f.junit.xml" \
    -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" -e STUDY="${STUDY:-}" -e PARTICIPATION="${PARTICIPATION:-}" -e WALLET_PIN="${WALLET_PIN:-}" "$FLOWDIR/$f.yaml") > "$OUT/$f.log" 2>&1
  rc=$?
  # Device-side invariant after every flow: no screen capture may still be running.
  sleep 2
  active=$(adb shell dumpsys media_projection | grep -c packageName)
  echo "$f EXIT=$rc active_projections=$active" | tee -a "$OUT/summary.txt"
  [ "$active" = "0" ] || rc=1
  if [ "$f" = devnet-transfer-unfunded ]; then
    # Server-side: the intent must still be awaiting a signature, with none recorded.
    state=$(curl -s -H "authorization: Bearer $BUILDER_TOKEN" "http://127.0.0.1:8787/participations/$PARTICIPATION/devnet-transfers" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).items[0];console.log(t.status+" signature="+t.signature)})')
    echo "  server transfer state: $state" | tee -a "$OUT/summary.txt"
    [ "$state" = "awaiting_signature signature=null" ] || rc=1
  fi
  [ $rc -eq 0 ] || status=1
done
echo "results: $OUT"
exit $status
