#!/bin/zsh
# E-xx persistence across API restart (local-api). Run from apps/api. Usage: restart-persistence.sh <scratchDir> [port]
# Starts the SQLite API on loopback with a fresh scratch data dir (never 8787 / the live USB DB),
# seeds synthetic data, kills ONLY the recorded PIDs, restarts on the same data dir, and re-reads
# every view with the same bearer tokens. Tokens stay in <scratchDir>, never in evidence.
S=$1; PORT=${2:-8862}; H=${0:A:h}/restart-persistence.mjs
[[ $PORT == 8787 ]] && { echo "refusing 8787"; exit 64; }
rm -rf $S/restart-data $S/restart-state.json; mkdir -p $S/restart-data
export POCKETQA_ENV=development POCKETQA_DATA_BACKEND=sqlite POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local POCKETQA_API_HOST=127.0.0.1 POCKETQA_API_PORT=$PORT POCKETQA_DATA_DIR=$S/restart-data
start() { npx tsx src/server.ts > $S/restart-server-$1.log 2>&1 & echo $! ; }
waitup() { for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:$PORT/health && return 0; sleep 0.5; done; return 1; }
date -u +%FT%TZ; echo "HEAD $(git rev-parse --short HEAD); apps/api+packages diff vs frozen 7beaad5: '$(git diff --stat 7beaad5..HEAD -- . ../../packages | tail -1)' (empty = identical)"
echo "env: POCKETQA_ENV=development POCKETQA_DATA_BACKEND=sqlite POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local POCKETQA_API_HOST=127.0.0.1 POCKETQA_API_PORT=$PORT POCKETQA_DATA_DIR=<scratch>/restart-data (fresh, empty)"
P1=$(start 1); waitup; L1=$(lsof -nP -tiTCP:$PORT -sTCP:LISTEN); echo "start #1: launcher pid $P1, listener pid $L1"
echo '$ node restart-persistence.mjs seed'; node $H seed http://127.0.0.1:$PORT $S/restart-state.json; echo "seed exit $?"
echo "\$ kill $L1 $P1   (recorded PIDs only)"; kill $L1 $P1 2>/dev/null; sleep 2
curl -s -o /dev/null -w "health while stopped: %{http_code}\n" http://127.0.0.1:$PORT/health
echo "listeners on $PORT after kill: $(lsof -nP -iTCP:$PORT -sTCP:LISTEN | tail -n +2 | wc -l | tr -d ' ')"
echo "sqlite file bytes: $(stat -f %z $S/restart-data/pocketqa.sqlite)"
P2=$(start 2); waitup; L2=$(lsof -nP -tiTCP:$PORT -sTCP:LISTEN); echo "start #2: launcher pid $P2, new listener pid $L2"
echo '$ node restart-persistence.mjs read   (same bearer tokens as before the restart)'; node $H read http://127.0.0.1:$PORT $S/restart-state.json; echo "read exit $?"
kill $L2 $P2 2>/dev/null; sleep 1; echo "stopped #2 (recorded PIDs $L2 $P2); listeners on $PORT at end: $(lsof -nP -iTCP:$PORT -sTCP:LISTEN | tail -n +2 | wc -l | tr -d ' ')"
