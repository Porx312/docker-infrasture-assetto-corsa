#!/usr/bin/env bash
# Diagnose Convex invalidation → Redis ban key → telemetry kick pipeline.
# Usage: ./scripts/verify-user-ban-pipeline.sh [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-76561199230780195}"
PREFIX="${USER_INVALIDATED_REDIS_PREFIX:-ac:user:invalidated:}"
BAN_KEY="${PREFIX}${STEAM_ID}"
PLAYER_KEY="ac:hud:player:${STEAM_ID}"

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

echo "=== User ban pipeline: ${STEAM_ID} ==="
echo ""

echo "1) Convex getPlayerJoinContext (ban + HUD)"
if [[ ! -f "${ROOT}/ac-data/dist/services/hud/hudConvex.js" ]]; then
  echo "   ac-data dist missing — run: cd ac-data && npm run build"
else
  if "${ROOT}/scripts/verify-convex-player-join.sh" "${STEAM_ID}" 2>&1; then
    echo "   OK: unified join query succeeded"
  else
    echo "   WARN: deploy workerPlayers:getPlayerJoinContext — see docs/CONVEX_PLAYER_JOIN_CONTEXT.md"
  fi
fi
echo ""

echo "2) Redis ban key: ${BAN_KEY}"
BAN_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${BAN_KEY}" 2>/dev/null || true)"
if [[ -n "${BAN_VALUE}" && "${BAN_VALUE}" != "(nil)" ]]; then
  echo "   OK: ban key present (value=${BAN_VALUE})"
else
  echo "   MISSING: ac-data has not written ban state yet"
  echo "   → connect once so player_join triggers refreshPlayerJoinFromConvex"
fi
echo ""

echo "3) Redis HUD player cache: ${PLAYER_KEY}"
PLAYER_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${PLAYER_KEY}" 2>/dev/null || true)"
if [[ -n "${PLAYER_VALUE}" && "${PLAYER_VALUE}" != "(nil)" ]]; then
  echo "${PLAYER_VALUE}" | head -c 400
  echo ""
  if echo "${PLAYER_VALUE}" | rg -q 'user_invalidated|isInvalidated|is_invalidated'; then
    echo "   OK: player cache shows invalidation"
  else
    echo "   INFO: player cache exists but no invalidation markers"
  fi
else
  echo "   (empty)"
fi
echo ""

echo "4) Checklist"
echo "   - USER_BAN_ENABLED should be true in .env.local"
echo "   - ac-data.log should show [player-join] and [user-ban] marked after join"
echo "   - telemetry-data.log should show ban check or kicked on connect"
echo ""
echo "Manual kick test: ./scripts/verify-user-ban.sh ${STEAM_ID}"
