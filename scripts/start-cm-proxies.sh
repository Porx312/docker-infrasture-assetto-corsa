#!/bin/bash
# Start Content Manager details proxies for all server instances.
#
# Usage:
#   ./scripts/start-cm-proxies.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_JS="$ROOT/scripts/cm-details-proxy.mjs"
PID_DIR="$ROOT/server/shared/cm-proxy-pids"
LOG_DIR="$ROOT/server/shared/cm-proxy-logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

start_one() {
  local name="$1"
  local dir="$ROOT/server/$name"
  local params="$dir/cfg/cm_wrapper_params.json"
  if [ ! -f "$params" ]; then
    return
  fi
  local pid_file="$PID_DIR/$name.pid"
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "CM proxy already running: $name (PID $(cat "$pid_file"))"
    return
  fi
  nohup node "$PROXY_JS" "$dir" > "$LOG_DIR/$name.log" 2>&1 &
  echo $! > "$pid_file"
  echo "Started CM proxy: $name (PID $(cat "$pid_file"))"
}

for n in server server-{1..19}; do
  start_one "$n"
done

echo "CM proxies started."
