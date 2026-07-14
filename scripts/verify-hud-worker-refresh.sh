#!/usr/bin/env bash
# POST /hud/worker/refresh-user — Convex should call this when isInvalidated changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/.env.local" 2>/dev/null || source "$ROOT/.env.production" 2>/dev/null || true

STEAM_ID="${1:-}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 STEAM_ID"
  exit 1
fi

if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing in env"
  exit 1
fi

echo "POST $BASE_URL/hud/worker/refresh-user steamId=$STEAM_ID"
curl -sfS -X POST "$BASE_URL/hud/worker/refresh-user" \
  -H "Content-Type: application/json" \
  -d "{\"workerSecret\":\"$SECRET\",\"steamId\":\"$STEAM_ID\"}"
echo
echo "OK — check ac-data.log for [player-join] and connected HUD clients for hud_error / hud_session"
