#!/usr/bin/env bash
# Root-cause regression for the voice stall (docs/plans/native-capture-pipeline.md), EMULATOR only,
# synthetic content, host mic OFF. MediaRecorder's audio track stopped for good when bursts of system
# work hit a live recording (UI automation dumps, a package install, rotation, lock). This replays
# those stimuli DURING one recording, driven by adb only (a new Maestro session can't attach while a
# projection is live on this emulator), then stops in the app, uploads through Keep + Upload to the
# LOCAL API, and gates the file with check-voice.py. MODE=control runs the same recording hands-off.
# Lifecycle modes, same adb-only driving: call (the emulator's phone call takes the mic: "the call
# always receives audio"), micoff (appops RECORD_AUDIO ignore), dka (always_finish_activities while
# away), death (force-stop while recording).
# Emulator launched with -no-audio: the host's audio (and microphone) is never touched.
# GATE="--structure-only" when the emulator's microphone delivers digital silence (-no-audio): the
# gate then proves a continuous audio track only, and says so.
# Usage: SERIAL=emulator-5556 MEDIA_DIR=<local API media dir> OUT=<dir> MODE=<mode> [GATE=...] ./voice-stress.sh
set -u
cd "$(dirname "$0")"
SERIAL=${SERIAL:-emulator-5556}
MODE=${MODE:-stress}
OUT=${OUT:-$PWD/.results/stress-$MODE-$(date +%H%M%S)}
MEDIA_DIR=${MEDIA_DIR:?set MEDIA_DIR to the local API media directory}
PKG=com.reshareai.pocketqa
A=(adb -s "$SERIAL")
mkdir -p "$OUT"
FL="$PWD"
T0=$(date +%s)
log() { echo "[$(date +%H:%M:%S) +$(( $(date +%s) - T0 ))s] $*" | tee -a "$OUT/timeline.txt"; }
dump() { "${A[@]}" exec-out uiautomator dump /dev/tty 2>/dev/null; }
# Taps the centre of the first node with this resource-id; scrolls down to find it (3 tries).
tap_id() {
  local id=$1 b i
  for i in 1 2 3 4; do
    b=$(dump | grep -o "resource-id=\"$id\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)
    if [ -n "$b" ]; then
      set -- $(echo "$b" | tr '[],' '   ')
      "${A[@]}" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); return 0
    fi
    "${A[@]}" shell input swipe 540 1700 540 900 300; sleep 1
  done
  return 1
}
tap_text() {
  local t=$1 b
  b=$(dump | grep -o "text=\"$t\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)
  [ -n "$b" ] || return 1
  set -- $(echo "$b" | tr '[],' '   ')
  "${A[@]}" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
projections() { "${A[@]}" shell dumpsys media_projection | grep -c packageName; }
away() { "${A[@]}" shell am start -a android.settings.SETTINGS >/dev/null; sleep 3; log "away in Settings"; }
# Back to Pocket QA; if Android recreated it (dka, death), go back into this study's session.
come_back() {
  "${A[@]}" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
  if ! dump | grep -q 'text="Your session"'; then
    tap_text "$STUDY" && sleep 4 && tap_id open-session && sleep 5 && log "reopened the session from the study"
  fi
}
maestro_run() {
  (cd "$OUT" && maestro --device "$SERIAL" test --debug-output="$OUT" --flatten-debug-output \
    -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" -e STUDY="$STUDY" "$FL/$1" >> "$OUT/maestro.log" 2>&1)
}

eval "$(node seed.mjs | sed 's/^/export /')"
"${A[@]}" reverse tcp:8787 tcp:8787 >/dev/null
"${A[@]}" logcat -c
log "mode=$MODE load=$(sysctl -n vm.loadavg)"
maestro_run _voice-start.yaml || { log "start FAILED"; exit 1; }
log "recording (projections=$("${A[@]}" shell dumpsys media_projection | grep -c packageName))"
case "$MODE" in
  stress)
    sleep 20; log "rotate landscape"; "${A[@]}" shell settings put system accelerometer_rotation 0; "${A[@]}" shell settings put system user_rotation 1
    sleep 6; log "rotate portrait"; "${A[@]}" shell settings put system user_rotation 0
    sleep 10; log "5 uiautomator dumps"; for i in 1 2 3 4 5; do dump >/dev/null; done; log "dumps done"
    sleep 10; log "dexopt burst (compile -f speed deskclock)"; "${A[@]}" shell cmd package compile -m speed -f com.google.android.deskclock >/dev/null; log "dexopt done"
    sleep 10; log "lock"; "${A[@]}" shell input keyevent KEYCODE_SLEEP
    sleep 8; log "locked: projections=$(projections)"
    "${A[@]}" shell input keyevent KEYCODE_WAKEUP; sleep 1; "${A[@]}" shell wm dismiss-keyguard; log "unlocked"
    sleep 10; log "5 more dumps"; for i in 1 2 3 4 5; do dump >/dev/null; done; log "dumps done"
    sleep 60 ;;
  control) sleep 150 ;;
  call)
    sleep 20; away
    "${A[@]}" emu gsm call 5550100 >/dev/null; sleep 2; "${A[@]}" emu gsm accept 5550100 >/dev/null; log "call accepted"
    sleep 8; log "in call: projections=$(projections)"
    "${A[@]}" emu gsm cancel 5550100 >/dev/null; log "call ended" ;;
  micoff)
    sleep 20; away
    log "appops before: $("${A[@]}" shell appops get "$PKG" RECORD_AUDIO | tr -d '\r' | tr '\n' ' ')"
    "${A[@]}" shell appops set "$PKG" RECORD_AUDIO ignore; log "mic op ignored"
    sleep 8; log "mic ignored: projections=$(projections)"
    "${A[@]}" shell appops set "$PKG" RECORD_AUDIO allow; log "appops after: $("${A[@]}" shell appops get "$PKG" RECORD_AUDIO | tr -d '\r' | tr '\n' ' ')" ;;
  dka)
    sleep 10; "${A[@]}" shell settings put global always_finish_activities 1; log "always_finish_activities=1"
    away; sleep 20; log "away, screen destroyed: projections=$(projections)" ;;
  death)
    sleep 20; away; "${A[@]}" shell am force-stop "$PKG"; sleep 3; log "force-stopped: projections=$(projections)" ;;
esac
log "back to Pocket QA"; come_back
if [ "$(projections)" != 0 ]; then
  tap_id record-stop && log "tapped Stop" || log "Stop not found"
  sleep 5
else
  log "projection already ended (stopped by the system, the mic watch, or death)"
fi
if [ "$MODE" = dka ]; then "${A[@]}" shell settings put global always_finish_activities 0; log "always_finish_activities reset to $("${A[@]}" shell settings get global always_finish_activities | tr -d '\r')"; fi
dump > "$OUT/screen.xml"; "${A[@]}" exec-out screencap -p > "$OUT/back.png"
grep -oE 'text="[^"]*(microphone stopped|Voice stops|interrupted|couldn.t be checked)[^"]*"' "$OUT/screen.xml" | head -3 | while read -r l; do log "on screen: $l"; done
log "after stop: projections=$("${A[@]}" shell dumpsys media_projection | grep -c packageName)"
"${A[@]}" logcat -d > "$OUT/logcat.txt"
grep -E "PqaCapture" "$OUT/logcat.txt" | tee -a "$OUT/timeline.txt"
log "overrun lines: $(grep -c 'AudioRecord reported overrun' "$OUT/logcat.txt")"
if [ "$MODE" = death ]; then
  grep -q "interrupted" "$OUT/screen.xml" && ! grep -q 'resource-id="segment-recorded"' "$OUT/screen.xml"; rc=$?
  log "death: interrupted notice shown and no clip offered: $([ $rc = 0 ] && echo yes || echo NO)"
  log "EXIT=$rc"; exit $rc
fi
TAIL=(); case "$MODE" in call|micoff) TAIL=(--allow-silent-tail 5) ;; esac
before=$(ls -t "$MEDIA_DIR" | head -1)
maestro_run _voice-keep-upload.yaml && log "uploaded" || log "upload flow FAILED (a voice-incomplete clip has no Keep)"
newest=$(ls -t "$MEDIA_DIR" | head -1)
if [ "$newest" != "$before" ]; then
  cp "$MEDIA_DIR/$newest" "$OUT/uploaded.mp4"
  ./check-voice.py "$OUT/uploaded.mp4" ${TAIL[@]+"${TAIL[@]}"} ${GATE:-} | tee "$OUT/check-voice.txt" | tee -a "$OUT/timeline.txt"
  grep -qE '^PASS' "$OUT/check-voice.txt"; rc=$?
else
  "${A[@]}" exec-out screencap -p > "$OUT/no-upload.png"; rc=1
fi
"${A[@]}" shell settings put system user_rotation 0
log "EXIT=$rc"
exit $rc
