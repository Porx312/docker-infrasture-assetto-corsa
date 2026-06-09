#!/bin/bash
# Stop Content Manager details proxies.
#
# Usage:
#   ./scripts/stop-cm-proxies.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/server/shared/cm-proxy-pids"

if [ -d "$PID_DIR" ]; then
  for pid_file in "$PID_DIR"/*.pid; do
    [ -f "$pid_file" ] || continue
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "Stopped CM proxy PID $pid"
    fi
    rm -f "$pid_file"
  done
fi

pkill -f "cm-details-proxy.mjs" 2>/dev/null || true
echo "CM proxies stopped."
