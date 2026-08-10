#!/usr/bin/env bash
# POST /hud/worker/refresh-user — Convex push sync (ban, registration, prefs).
# Usage: ./scripts/verify-hud-worker-refresh.sh STEAM_ID [reason]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/.env.local" 2>/dev/null || source "$ROOT/.env.production" 2>/dev/null || true

STEAM_ID="${1:-}"
REASON="${2:-invalidated}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"
BAN_PREFIX="${USER_INVALIDATED_REDIS_PREFIX:-ac:user:invalidated:}"
PREFS_SAVE_PREFIX="${USER_PREFS_SAVE_TIME_PREFIX:-ac:user:prefs:save_time:}"
PREFS_BATTLE_PREFIX="${USER_PREFS_ACCEPT_BATTLE_PREFIX:-ac:user:prefs:accept_battle:}"

REDIS_ARGS=()
if [[ -n "${REDIS_HOST:-}" ]]; then
  REDIS_ARGS+=(-h "$REDIS_HOST")
fi
if [[ -n "${REDIS_PORT:-}" ]]; then
  REDIS_ARGS+=(-p "$REDIS_PORT")
fi
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  REDIS_ARGS+=(-a "$REDIS_PASSWORD")
fi

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 STEAM_ID [reason]"
  exit 1
fi

if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing in env"
  exit 1
fi

echo "POST $BASE_URL/hud/worker/refresh-user steamId=$STEAM_ID reason=$REASON"
curl -sfS -X POST "$BASE_URL/hud/worker/refresh-user" \
  -H "Content-Type: application/json" \
  -d "{\"workerSecret\":\"$SECRET\",\"steamId\":\"$STEAM_ID\",\"reason\":\"$REASON\"}"
echo
echo ""

echo "Redis after refresh (worker push uses publishEnforcement=true for ban kick):"
echo "  ban key ${BAN_PREFIX}${STEAM_ID}: $(redis-cli "${REDIS_ARGS[@]}" GET "${BAN_PREFIX}${STEAM_ID}" 2>/dev/null || echo '(redis unavailable)')"
echo "  saveTime ${PREFS_SAVE_PREFIX}${STEAM_ID}: $(redis-cli "${REDIS_ARGS[@]}" GET "${PREFS_SAVE_PREFIX}${STEAM_ID}" 2>/dev/null || echo '(redis unavailable)')"
echo "  acceptBattle ${PREFS_BATTLE_PREFIX}${STEAM_ID}: $(redis-cli "${REDIS_ARGS[@]}" GET "${PREFS_BATTLE_PREFIX}${STEAM_ID}" 2>/dev/null || echo '(redis unavailable)')"
echo ""
echo "OK — check ac-data.log for [player-join] publishEnforcement=true and [user-prefs]"
echo "Connected HUD clients should receive hud_error / hud_session via SSE"
echo "Ban / not-registered should pub/sub kick on all servers (mid-session)"
