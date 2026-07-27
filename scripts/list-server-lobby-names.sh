#!/usr/bin/env bash
# List lobby NAME= from each server instance (for fleet collision checks).
# Usage: ./scripts/list-server-lobby-names.sh [servers_root]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVERS_ROOT="${1:-${SERVERS_PATH:-$ROOT/server}}"

if [[ ! -d "$SERVERS_ROOT" ]]; then
  echo "FAIL: servers root not found: $SERVERS_ROOT"
  exit 1
fi

# shellcheck disable=SC1090
if [[ -f "$ROOT/.env.production" ]]; then
  set -a && source "$ROOT/.env.production" && set +a
elif [[ -f "$ROOT/.env.local" ]]; then
  set -a && source "$ROOT/.env.local" && set +a
fi

INSTANCE="${AC_INSTANCE_ID:-default}"
echo "=== Lobby names (AC_INSTANCE_ID=$INSTANCE) ==="
echo "servers_root: $SERVERS_ROOT"
echo ""
printf "%-20s %s\n" "INSTANCE" "NAME"
printf "%-20s %s\n" "--------" "----"

declare -A SEEN
DUP=0

while IFS= read -r -d '' cfg; do
  dir="$(basename "$(dirname "$(dirname "$cfg")")")"
  name="$(grep -E '^NAME=' "$cfg" | head -n1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -z "$name" ]]; then
    name="(missing NAME=)"
  fi
  norm="$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')"
  fleet_key="${INSTANCE}_${norm}"
  printf "%-20s %s\n" "$dir" "$name"
  echo "  battle serverKey: ${fleet_key}"
  if [[ -n "${SEEN[$norm]+x}" ]]; then
    echo "  WARN: duplicate lobby NAME on this host (dirs: ${SEEN[$norm]} and $dir)"
    DUP=1
  else
    SEEN[$norm]="$dir"
  fi
done < <(find "$SERVERS_ROOT" -path '*/cfg/server_cfg.ini' -print0 2>/dev/null | sort -z)

echo ""
echo "Compare output across VPS hosts. With instance-prefixed keys, same NAME on"
echo "different VPS is OK if AC_INSTANCE_ID differs. Same NAME + same instance id"
echo "on shared Redis causes battle HUD collisions."

exit "$DUP"
