#!/usr/bin/env bash
# Push a local CONTENT_PATH car/track folder to a peer edge via
# POST /api/mod-agent/v1/trees/install (mod peer auth).
#
# Usage:
#   CONTENT_PATH=... EDGE_URL=http://185.187.235.11:3000 \
#     ./scripts/push-content-tree-to-edge.sh car js_opera_fairladyz
#   ./scripts/push-content-tree-to-edge.sh --all-from-pool   # all cars+tracks under CONTENT_PATH
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Preserve caller overrides — sourcing .env.local would otherwise clobber them.
_SAVED_CONTENT_PATH="${CONTENT_PATH-}"
_SAVED_EDGE_URL="${EDGE_URL-}"
# shellcheck disable=SC1091
[[ -f "$ROOT/.env.local" ]] && set -a && source "$ROOT/.env.local" && set +a

CONTENT_PATH="${_SAVED_CONTENT_PATH:-${CONTENT_PATH:-$ROOT/server/content}}"
EDGE_URL="${_SAVED_EDGE_URL:-${EDGE_URL:-}}"
SECRET="${MOD_PEER_SECRET:-${FLEET_EDGE_SECRET:-${CONVEX_WORKER_SECRET:-}}}"

if [[ -z "$EDGE_URL" || -z "$SECRET" ]]; then
  echo "EDGE_URL and MOD_PEER_SECRET|FLEET_EDGE_SECRET|CONVEX_WORKER_SECRET required" >&2
  exit 1
fi

CONTENT_PATH="${CONTENT_PATH%/}"
EDGE_URL="${EDGE_URL%/}"

push_one() {
  local kind="$1" slug="$2"
  local dir
  case "$kind" in
    car) dir="$CONTENT_PATH/cars/$slug" ;;
    track) dir="$CONTENT_PATH/tracks/$slug" ;;
    *) echo "kind must be car|track" >&2; return 1 ;;
  esac
  if [[ ! -d "$dir" ]]; then
    echo "SKIP missing $dir" >&2
    return 0
  fi
  echo "PUSH $kind/$slug → $EDGE_URL"
  # Tar folder contents so extract yields <slug>/...
  local tmp
  tmp="$(mktemp)"
  tar -C "$(dirname "$dir")" -cf "$tmp" "$slug"
  local code
  code="$(curl -sS -o /tmp/push-tree-resp.json -w '%{http_code}' \
    -X POST \
    -H "X-Worker-Secret: $SECRET" \
    -H "Content-Type: application/x-tar" \
    --data-binary @"$tmp" \
    "$EDGE_URL/api/mod-agent/v1/trees/install?kind=${kind}&slug=${slug}")"
  rm -f "$tmp"
  echo "  HTTP $code $(head -c 200 /tmp/push-tree-resp.json 2>/dev/null || true)"
  [[ "$code" == "200" ]]
}

if [[ "${1:-}" == "--all-from-pool" ]]; then
  fail=0
  for d in "$CONTENT_PATH"/cars/*/; do
    [[ -d "$d" ]] || continue
    push_one car "$(basename "$d")" || fail=1
  done
  for d in "$CONTENT_PATH"/tracks/*/; do
    [[ -d "$d" ]] || continue
    push_one track "$(basename "$d")" || fail=1
  done
  exit "$fail"
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 car|track <slug>  OR  $0 --all-from-pool" >&2
  exit 1
fi
push_one "$1" "$2"
