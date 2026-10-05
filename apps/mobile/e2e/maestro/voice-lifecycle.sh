#!/usr/bin/env bash
# Native screen + voice lifecycle on the Android EMULATOR (docs/plans/native-screen-voice-recording.md;
# pqa-qa r1 P2-A/P2-B): rotation, screen lock, a phone call taking the microphone, the microphone op
# switched off (appops), the screen destroyed in the background (always_finish_activities), and process
# death. Synthetic emulator apps and data only; run with the host microphone OFF. Each scenario seeds a
# fresh session, uploads its clip through the app's explicit Keep + Upload to the LOCAL API, and gates
# the uploaded file with check-voice.py (per-stream |a-v| <= 1 s and windowed RMS over the whole clip).
# Usage: SERIAL=emulator-5556 MEDIA_DIR=<local API media dir> OUT=<dir> ./voice-lifecycle.sh [rotation lock call micoff dka death]
set -u
cd "$(dirname "$0")"
SERIAL=${SERIAL:-emulator-5556}
OUT=${OUT:-$PWD/.results/lifecycle-$(date +%Y%m%d-%H%M%S)}
MEDIA_DIR=${MEDIA_DIR:?set MEDIA_DIR to the local API media directory}
PKG=com.reshareai.pocketqa
mkdir -p "$OUT"
A=(adb -s "$SERIAL")
"${A[@]}" reverse tcp:8787 tcp:8787 >/dev/null
FL="$PWD"
log() { echo "[$s] $*" | tee -a "$OUT/summary.txt"; }
projections() { "${A[@]}" shell dumpsys media_projection | grep -c packageName; }
service_up() { "${A[@]}" shell dumpsys activity services "$PKG" | grep -c ScreenCaptureService; }
# The emulator's own system apps sometimes ANR under load; their dialog blocks the UI driver. Tap Wait.
dismiss_anr() {
  local xml b
  xml=$("${A[@]}" exec-out uiautomator dump /dev/tty 2>/dev/null)
  if echo "$xml" | grep -q "isn.t responding"; then
    b=$(echo "$xml" | grep -o 'text="Wait"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)
    if [ -n "$b" ]; then
      set -- $(echo "$b" | tr '[],' '   ')
      "${A[@]}" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
      log "dismissed a system 'isn't responding' dialog"
    fi
  fi
}
# One Maestro flow; retried once if its Android driver fails to start (seen under emulator load).
run() {
  local i
  for i in 1 2; do
    dismiss_anr
    (cd "$OUT/$s" && maestro --device "$SERIAL" test --debug-output="$OUT/$s" --flatten-debug-output \
      -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" -e STUDY="$STUDY" "$FL/$1" >> "$OUT/$s/maestro.log" 2>&1) && return 0
    grep -q "driver did not start up in time" "$OUT/$s/maestro.log" || return 1
    log "maestro driver did not start; retrying $1"
  done
  return 1
}
# Keep + upload the clip, then gate the newest file the local API stored.
upload_and_check() {
  local before newest
  before=$(ls -t "$MEDIA_DIR" 2>/dev/null | head -1)
  run _voice-keep-upload.yaml || { log "upload flow FAILED"; return 1; }
  newest=$(ls -t "$MEDIA_DIR" | head -1)
  [ "$newest" != "$before" ] || { log "no new upload"; return 1; }
  cp "$MEDIA_DIR/$newest" "$OUT/$s/uploaded.mp4"
  log "uploaded $(shasum -a 256 "$OUT/$s/uploaded.mp4" | cut -c1-16)…"
  ./check-voice.py "$OUT/$s/uploaded.mp4" "$@" | tee "$OUT/$s/check-voice.txt" | sed "s/^/[$s]   /" | tee -a "$OUT/summary.txt"
  grep -q '^PASS' "$OUT/$s/check-voice.txt"
}

SCEN=("$@"); [ $# -gt 0 ] || SCEN=(rotation lock call micoff dka death)
status=0
for s in "${SCEN[@]}"; do
  mkdir -p "$OUT/$s"
  eval "$(node seed.mjs | sed 's/^/export /')"
  rc=0
  case "$s" in
    dka)
      # "Don't keep activities": leaving Pocket QA destroys its screen while the recording runs.
      "${A[@]}" shell settings put global always_finish_activities 1
      trap '"${A[@]}" shell settings put global always_finish_activities 0' EXIT ;;
  esac
  run _voice-start.yaml || rc=1
  log "started rc=$rc projections=$(projections)"
  case "$s" in
    rotation)
      "${A[@]}" shell settings put system accelerometer_rotation 0
      "${A[@]}" shell settings put system user_rotation 1; sleep 6
      log "landscape: projections=$(projections)"
      "${A[@]}" shell settings put system user_rotation 0; sleep 6
      run _voice-stop-in-app.yaml || rc=1
      upload_and_check || rc=1 ;;
    lock)
      "${A[@]}" shell input keyevent KEYCODE_SLEEP; sleep 8
      log "locked: projections=$(projections) service=$(service_up)"
      "${A[@]}" shell input keyevent KEYCODE_WAKEUP; sleep 1; "${A[@]}" shell wm dismiss-keyguard; sleep 2
      # Android 15 QPR1+ stops projection on lock (the clip is waiting); this image may keep recording.
      if [ "$(projections)" = 0 ]; then run _voice-return.yaml || rc=1; else run _voice-stop-in-app.yaml || rc=1; fi
      upload_and_check || rc=1 ;;
    call)
      run _home-then-settings.yaml || rc=1
      "${A[@]}" emu gsm call 5550100; sleep 2; "${A[@]}" emu gsm accept 5550100; sleep 8
      log "in call: projections=$(projections) service=$(service_up)"
      "${A[@]}" emu gsm cancel 5550100; sleep 2
      if [ "$(projections)" = 0 ]; then run _voice-return.yaml || rc=1; else log "still recording after the call"; run _voice-stop-in-app.yaml || rc=1; fi
      upload_and_check --allow-silent-tail 5 || rc=1 ;;
    micoff)
      # The microphone op is switched off while recording (the system silences our capture), so the
      # app must stop with reason "mic" and keep what it had. `pm revoke` would kill the process instead.
      run _home-then-settings.yaml || rc=1
      mode=$("${A[@]}" shell appops get "$PKG" RECORD_AUDIO | tr -d '\r')
      log "appops before: $mode"
      "${A[@]}" shell appops set "$PKG" RECORD_AUDIO ignore; sleep 6
      log "mic op ignored: projections=$(projections) service=$(service_up)"
      "${A[@]}" shell appops set "$PKG" RECORD_AUDIO allow
      log "appops after reset: $("${A[@]}" shell appops get "$PKG" RECORD_AUDIO | tr -d '\r')"
      if [ "$(projections)" = 0 ]; then run _voice-return.yaml || rc=1; else log "still recording with the mic op ignored"; rc=1; run _voice-stop-in-app.yaml; fi
      upload_and_check --allow-silent-tail 5 || rc=1 ;;
    dka)
      run _home-then-settings.yaml || rc=1
      sleep 8
      log "away with the screen destroyed: projections=$(projections) service=$(service_up)"
      run _voice-stop-in-app.yaml || rc=1
      upload_and_check || rc=1
      "${A[@]}" shell settings put global always_finish_activities 0; trap - EXIT
      log "always_finish_activities reset to $("${A[@]}" shell settings get global always_finish_activities | tr -d '\r')" ;;
    death)
      run _home-then-settings.yaml || rc=1
      "${A[@]}" shell am force-stop "$PKG"; sleep 3
      log "after force-stop: projections=$(projections) service=$(service_up)"
      run _voice-no-clip.yaml || rc=1 ;;
  esac
  "${A[@]}" exec-out screencap -p > "$OUT/$s/final.png"
  sleep 2
  active=$(projections)
  log "EXIT=$rc active_projections_after=$active"
  [ "$rc" = 0 ] && [ "$active" = 0 ] || status=1
  # Never leave a recording running into the next scenario.
  [ "$active" = 0 ] || "${A[@]}" shell am force-stop "$PKG"
done
echo "results: $OUT"
exit $status
