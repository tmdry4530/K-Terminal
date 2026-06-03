#!/usr/bin/env bash
# Bring up auto-dom bridge (ingest_only by default — no orders) + K Terminal Finance.
# The Crypto Signal agent runs separately (it posts to the bridge). Live trading stays gated
# by auto-dom's own env double-lock; this script never enables it.
#
#   AUTO_DOM_DIR=../auto-dom bash scripts/run-all.sh
set -euo pipefail
AUTO_DOM_DIR="${AUTO_DOM_DIR:-../auto-dom}"
PORT="${AUTO_DOM_BRIDGE_PORT:-8765}"
TERMINAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -d "$AUTO_DOM_DIR/src/auto_dom" ]; then
  echo "[1/2] auto-dom bridge ($AUTO_DOM_DIR) — mode from its .env (default ingest_only, no orders)"
  ( cd "$AUTO_DOM_DIR" && PYTHONPATH=src python3 -m auto_dom.bridge.http --host 127.0.0.1 --port "$PORT" ) &
  BRIDGE_PID=$!
  trap 'kill "$BRIDGE_PID" 2>/dev/null || true' EXIT
  sleep 2
  curl -s "http://127.0.0.1:$PORT/health" || echo "(bridge /health not ready — Python 3.13+ required)"
  echo
else
  echo "auto-dom not found at $AUTO_DOM_DIR. Clone it: git clone https://github.com/tmdry4530/auto-dom"
  echo "Terminal will still run; SIGNALS/GATE show 'offline' until the bridge is up."
fi

echo "[2/2] K Terminal Finance -> http://localhost:8080  (Ctrl+C to stop)"
cd "$TERMINAL_DIR" && npm start
