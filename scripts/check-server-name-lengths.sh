#!/bin/bash
# Warn when server NAME= is near or over AC lobby limit (128).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOBBY_MAX=128
WARN_CHARS=124

issues=0

while IFS= read -r ini; do
  name="$(grep -m1 '^NAME=' "$ini" | cut -d= -f2- || true)"
  [[ -z "$name" ]] && continue
  chars="${#name}"
  bytes="$(printf '%s' "$name" | wc -c)"
  inst="$(basename "$(dirname "$(dirname "$ini")")")"
  if (( chars >= LOBBY_MAX || bytes >= LOBBY_MAX )); then
    echo "OVER  $inst: $chars chars, $bytes utf8 bytes"
    issues=$((issues + 1))
  elif (( chars >= WARN_CHARS || bytes >= WARN_CHARS )); then
    echo "WARN  $inst: $chars chars, $bytes utf8 bytes"
  fi
done < <(find "$ROOT/server" -path '*/cfg/server_cfg.ini' | sort)

if (( issues > 0 )); then
  echo "Found $issues server(s) at or over lobby NAME limit ($LOBBY_MAX)."
  exit 1
fi

echo "All server NAME lengths are within safe limits."
