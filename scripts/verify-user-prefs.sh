#!/usr/bin/env bash
# Diagnose Convex profile prefs → Redis pref keys after player_join.
# Usage: ./scripts/verify-user-prefs.sh [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-76561199230780195}"
SAVE_PREFIX="${USER_PREFS_SAVE_TIME_PREFIX:-ac:user:prefs:save_time:}"
BATTLE_PREFIX="${USER_PREFS_ACCEPT_BATTLE_PREFIX:-ac:user:prefs:accept_battle:}"
SAVE_KEY="${SAVE_PREFIX}${STEAM_ID}"
BATTLE_KEY="${BATTLE_PREFIX}${STEAM_ID}"
SESSION_KEY="ac:hud:session:${STEAM_ID}"

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

pref_enabled() {
  local value="$1"
  if [[ -z "${value}" || "${value}" == "(nil)" ]]; then
    echo "true (default)"
  elif [[ "${value}" == "0" ]]; then
    echo "false"
  else
    echo "unexpected (${value})"
  fi
}

echo "=== User profile prefs: ${STEAM_ID} ==="
echo ""

echo "1) Convex getPlayerJoinContext (session.profile.saveTime / acceptBattle)"
if [[ ! -f "${ROOT}/ac-data/dist/services/hud/hudConvex.js" ]]; then
  echo "   ac-data dist missing — run: cd ac-data && npm run build"
else
  if "${ROOT}/scripts/verify-convex-player-join.sh" "${STEAM_ID}" 2>&1; then
    echo "   OK: join query succeeded — check profile for saveTime/acceptBattle in output"
  else
    echo "   WARN: deploy ProjectD with saveTime/acceptBattle — see docs/CONVEX_USER_PREFS.md"
  fi
fi
echo ""

echo "2) Redis saveTime pref: ${SAVE_KEY}"
SAVE_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${SAVE_KEY}" 2>/dev/null || true)"
echo "   saveTime enabled: $(pref_enabled "${SAVE_VALUE}")"
echo ""

echo "3) Redis acceptBattle pref: ${BATTLE_KEY}"
BATTLE_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${BATTLE_KEY}" 2>/dev/null || true)"
echo "   acceptBattle enabled: $(pref_enabled "${BATTLE_VALUE}")"
echo ""

echo "4) Redis HUD session cache: ${SESSION_KEY}"
SESSION_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${SESSION_KEY}" 2>/dev/null || true)"
if [[ -n "${SESSION_VALUE}" && "${SESSION_VALUE}" != "(nil)" ]]; then
  echo "${SESSION_VALUE}" | head -c 500
  echo ""
else
  echo "   (empty — connect in-game to trigger player_join)"
fi
echo ""

echo "5) Worker push refresh (immediate prefs / ban sync)"
if [[ -n "${CONVEX_WORKER_SECRET:-}" ]]; then
  echo "   Run: ./scripts/verify-hud-worker-refresh.sh ${STEAM_ID} prefs"
else
  echo "   Set CONVEX_WORKER_SECRET to test POST /hud/worker/refresh-user"
fi
echo ""

echo "6) Checklist"
echo "   - Missing Redis keys mean pref is true (opt-out default)"
echo "   - Key value \"0\" means pref is false"
echo "   - saveTime=false: laps skip Convex ingest; HUD still shows local times"
echo "   - acceptBattle=false: telemetry-data excludes player from new battles"
echo "   - Convex should schedule refresh-user on toggle (see CONVEX_PUSH_USER_SYNC.md)"
echo "   - ac-data.log: [user-prefs] after refresh; publishEnforcement=true on worker push"
echo ""
echo "See docs/CONVEX_USER_PREFS.md and docs/CONVEX_PUSH_USER_SYNC.md"
