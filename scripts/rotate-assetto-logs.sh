#!/usr/bin/env bash
# User-space log rotation (no sudo). Safe with nohup redirects (copy + truncate).
#
# Install cron (once):
#   crontab -e
#   */30 * * * * /home/jose/assetto-infra/scripts/rotate-assetto-logs.sh >/dev/null 2>&1
#
# Or rely on start.sh truncate-if-huge + system logrotate if installed:
#   sudo cp scripts/logrotate-assetto.conf /etc/logrotate.d/assetto-infra

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAX_BYTES=$((100 * 1024 * 1024))
KEEP=5

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

rotate_one "$ROOT/ac-data.log"
rotate_one "$ROOT/ac-data-backend.log"
rotate_one "$ROOT/telemetry-data.log"
