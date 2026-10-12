#!/usr/bin/env bash
# User-space log rotation (no sudo). Safe with nohup redirects (copy + truncate).
#
# Install cron (once):
#   crontab -e
#   */30 * * * * /home/jose/assetto-infra/scripts/rotate-assetto-logs.sh >/dev/null 2>&1
#
# Or rely on start.sh truncate-if-huge + system logrotate if installed:
#   sudo cp scripts/logrotate-assetto.conf /etc/logrotate.d/assetto-infra
#
# Override location: LOG_DIR=/path/to/logs ./scripts/rotate-assetto-logs.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
MAX_BYTES=$((100 * 1024 * 1024))
KEEP=5

mkdir -p "$LOG_DIR"

rotate_one() {
  local log="$1"
  [[ -f "$log" ]] || return 0
  local size
  size=$(stat -c '%s' "$log" 2>/dev/null || echo 0)
  [[ "$size" -gt "$MAX_BYTES" ]] || return 0

  local ts
  ts=$(date +%Y%m%d-%H%M%S)
  # copytruncate pattern: copy then truncate in place (writers keep same fd)
  cp -a "$log" "${log}.${ts}" || return 0
  : > "$log" || truncate -s 0 "$log" || true
  gzip -f "${log}.${ts}" 2>/dev/null || true

  # prune old rotations
  local base
  base="$(basename "$log")"
  local dir
  dir="$(dirname "$log")"
  # shellcheck disable=SC2012
  ls -1t "$dir"/"$base".*.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
  done
}

# Current layout under LOG_DIR
rotate_one "$LOG_DIR/ac-data-edge.log"
rotate_one "$LOG_DIR/ac-data-backend.log"
rotate_one "$LOG_DIR/telemetry-data.log"

# Legacy filenames (pre-centralization) still under LOG_DIR or repo root
rotate_one "$LOG_DIR/ac-data.log"
rotate_one "$ROOT/ac-data.log"
rotate_one "$ROOT/ac-data-backend.log"
rotate_one "$ROOT/telemetry-data.log"
