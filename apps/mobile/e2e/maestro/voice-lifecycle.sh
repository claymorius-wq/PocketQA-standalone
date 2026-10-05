#!/usr/bin/env bash
# Native screen + voice lifecycle on the Android EMULATOR (docs/plans/native-screen-voice-recording.md):
# rotation, screen lock, a phone call taking the microphone, and process death. Synthetic emulator
# apps and data only; run with the host microphone OFF. Each scenario seeds a fresh session.
# Usage: SERIAL=emulator-5556 OUT=<dir> ./voice-lifecycle.sh [rotation lock call death]
set -u
cd "$(dirname "$0")"
SERIAL=${SERIAL:-emulator-5556}
OUT=${OUT:-$PWD/.results/lifecycle-$(date +%Y%m%d-%H%M%S)}
mkdir -p "$OUT"
A=(adb -s "$SERIAL")
"${A[@]}" reverse tcp:8787 tcp:8787 >/dev/null
projections() { "${A[@]}" shell dumpsys media_projection | grep -c packageName; }
SCEN=("$@"); [ $# -gt 0 ] || SCEN=(rotation lock call death)
status=0
for s in "${SCEN[@]}"; do
  mkdir -p "$OUT/$s"
  eval "$(node seed.mjs | sed 's/^/export /')"
  FL="$PWD"
  run() { (cd "$OUT/$s" && maestro --device "$SERIAL" test --debug-output="$OUT/$s" --flatten-debug-output -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" -e STUDY="$STUDY" "$FL/$1" >> "$OUT/$s/maestro.log" 2>&1); }
  run _voice-start.yaml; rc=$?
  echo "[$s] started rc=$rc projections=$(projections)" | tee -a "$OUT/summary.txt"
  case "$s" in
    rotation)
      "${A[@]}" shell settings put system accelerometer_rotation 0
      "${A[@]}" shell settings put system user_rotation 1; sleep 4
      echo "[$s] landscape: projections=$(projections)" | tee -a "$OUT/summary.txt"
      "${A[@]}" shell settings put system user_rotation 0; sleep 3
      run _voice-stop-in-app.yaml; rc=$((rc + $?)) ;;
    lock)
      "${A[@]}" shell input keyevent KEYCODE_SLEEP; sleep 5
      echo "[$s] locked: projections=$(projections)" | tee -a "$OUT/summary.txt"
      "${A[@]}" shell input keyevent KEYCODE_WAKEUP; sleep 1; "${A[@]}" shell wm dismiss-keyguard; sleep 2
      run _voice-return.yaml; rc=$((rc + $?)) ;;
    call)
      "${A[@]}" emu gsm call 5550100; sleep 2; "${A[@]}" emu gsm accept 5550100; sleep 8
      echo "[$s] in call: projections=$(projections)" | tee -a "$OUT/summary.txt"
      "${A[@]}" emu gsm cancel 5550100; sleep 2
      run _voice-return.yaml; rc=$((rc + $?)) ;;
    death)
      "${A[@]}" shell am force-stop com.reshareai.pocketqa; sleep 3
      echo "[$s] after force-stop: projections=$(projections)" | tee -a "$OUT/summary.txt"
      run _voice-no-clip.yaml; rc=$((rc + $?)) ;;
  esac
  "${A[@]}" shell screencap -p > "$OUT/$s/final.png"
  sleep 2
  active=$(projections)
  echo "[$s] EXIT=$rc active_projections_after=$active" | tee -a "$OUT/summary.txt"
  [ "$rc" = 0 ] && [ "$active" = 0 ] || status=1
done
echo "results: $OUT"
exit $status
