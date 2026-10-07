#!/usr/bin/env bash
# Pins check-voice.py's verdicts on synthetic fixtures (ffmpeg lavfi: testsrc video + 220 Hz sine).
cd "$(dirname "$0")"
fail=0
expect() { local want=$1 f=$2; shift 2; ./check-voice.py "fixtures/$f" "$@" >/dev/null; local rc=$?; local got=$([ $rc = 0 ] && echo PASS || echo FAIL); [ "$got" = "$want" ] && echo "ok   $f -> $got" || { echo "BAD  $f -> $got (want $want)"; fail=1; }; }
expect PASS complete.mp4
expect FAIL voice-stops-at-2s.mp4
expect FAIL voice-gap-3s.mp4
expect FAIL silent.mp4
expect FAIL silent.mp4 --allow-silent-tail 5
# Structure only: silence passes as structure, but gaps and truncation still fail.
expect PASS silent.mp4 --structure-only
expect FAIL voice-gap-3s.mp4 --structure-only
expect FAIL voice-stops-at-2s.mp4 --structure-only
exit $fail
