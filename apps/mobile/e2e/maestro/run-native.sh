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
[ $# -gt 0 ] || FLOWS=(record-consent record-decline notifications-denied remove-segment system-stop notification-stop leave-while-recording wallet-decline wallet-link)
adb reverse tcp:8787 tcp:8787 >/dev/null
status=0
for f in "${FLOWS[@]}"; do
  eval "$(node seed.mjs | sed 's/^/export /')"
  mkdir -p "$OUT/$f"
  # takeScreenshot writes into the current directory, so run from the flow's result dir.
  (cd "$OUT/$f" && maestro test --debug-output="$OUT/$f" --flatten-debug-output --format=JUNIT --output="$OUT/$f.junit.xml" \
    -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" -e STUDY="$STUDY" -e WALLET_PIN="${WALLET_PIN:-}" "$FLOWDIR/$f.yaml") > "$OUT/$f.log" 2>&1
  rc=$?
  # Device-side invariant after every flow: no screen capture may still be running.
  sleep 2
  active=$(adb shell dumpsys media_projection | grep -c packageName)
  echo "$f EXIT=$rc active_projections=$active" | tee -a "$OUT/summary.txt"
  [ "$active" = "0" ] || rc=1
  [ $rc -eq 0 ] || status=1
done
echo "results: $OUT"
exit $status
