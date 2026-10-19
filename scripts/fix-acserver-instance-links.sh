#!/usr/bin/env bash
# Rewrite per-instance acServer/system symlinks to portable relative targets
# (../acServer). Fixes /home/jose/... absolute links on /root edges.
#
# Usage (on the edge host):
#   SERVERS_PATH=/root/assetto-infra/server ./scripts/fix-acserver-instance-links.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$ROOT/.env.local" ]] && set -a && source "$ROOT/.env.local" && set +a

SERVERS_PATH="${SERVERS_PATH:-$ROOT/server}"
SERVERS_PATH="$(cd "$SERVERS_PATH" && pwd)"

if [[ ! -e "$SERVERS_PATH/acServer" ]]; then
  echo "ERROR: missing $SERVERS_PATH/acServer (shared binary)" >&2
  exit 1
fi

fixed=0
for inst in "$SERVERS_PATH"/server "$SERVERS_PATH"/server-*; do
  [[ -d "$inst" ]] || continue
  name="$(basename "$inst")"
  link="$inst/acServer"
  rel="../acServer"
  rm -f "$link"
  ln -s "$rel" "$link"
  if [[ -e "$SERVERS_PATH/system" ]]; then
    rm -f "$inst/system"
    ln -s "../system" "$inst/system"
  fi
  target="$(readlink -f "$link" 2>/dev/null || true)"
  if [[ -n "$target" && -e "$target" ]]; then
    echo "OK $name → $target"
    fixed=$((fixed + 1))
  else
    echo "WARN $name link broken (readlink=$target)" >&2
  fi
done

echo "Fixed $fixed instance(s) under $SERVERS_PATH"
