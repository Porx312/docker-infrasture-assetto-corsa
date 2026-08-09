#!/usr/bin/env bash
# Diagnose Convex user_not_found → Redis not-registered key → telemetry kick pipeline.
# Usage: ./scripts/verify-user-registration-pipeline.sh [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-76561199230780195}"
PREFIX="${USER_NOT_REGISTERED_REDIS_PREFIX:-ac:user:not_registered:}"
REG_KEY="${PREFIX}${STEAM_ID}"
BAN_PREFIX="${USER_INVALIDATED_REDIS_PREFIX:-ac:user:invalidated:}"
BAN_KEY="${BAN_PREFIX}${STEAM_ID}"
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

echo "=== User registration pipeline: ${STEAM_ID} ==="
echo ""

echo "1) Convex getPlayerJoinContext (registration + HUD)"
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

echo "2) Redis not-registered key: ${REG_KEY}"
REG_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${REG_KEY}" 2>/dev/null || true)"
if [[ -n "${REG_VALUE}" && "${REG_VALUE}" != "(nil)" ]]; then
  echo "   OK: not-registered key present (value=${REG_VALUE})"
else
  echo "   MISSING: ac-data has not written registration state yet"
  echo "   → connect with an unlinked Steam ID so player_join triggers refreshPlayerJoinFromConvex"
fi
echo ""

echo "3) Redis ban key (should be empty for unregistered-only): ${BAN_KEY}"
BAN_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${BAN_KEY}" 2>/dev/null || true)"
if [[ -n "${BAN_VALUE}" && "${BAN_VALUE}" != "(nil)" ]]; then
  echo "   WARN: ban key present — ban kick takes precedence over registration kick"
else
  echo "   OK: no ban key"
fi
echo ""

echo "4) Redis HUD player cache: ${PLAYER_KEY}"
PLAYER_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${PLAYER_KEY}" 2>/dev/null || true)"
if [[ -n "${PLAYER_VALUE}" && "${PLAYER_VALUE}" != "(nil)" ]]; then
  echo "${PLAYER_VALUE}" | head -c 400
  echo ""
  if echo "${PLAYER_VALUE}" | rg -q 'user_not_found'; then
    echo "   OK: player cache shows user_not_found"
  else
    echo "   INFO: player cache exists"
  fi
else
  echo "   (empty)"
fi
echo ""

echo "5) Checklist"
echo "   - USER_REGISTRATION_REQUIRED should be true in .env.local"
echo "   - Kick message: ${USER_NOT_REGISTERED_KICK_MESSAGE:-You need a ProjectD account and link Steam to play on this server.}"
echo "   - Warn delay: ${USER_NOT_REGISTERED_WARN_DELAY_SEC:-3}s before kick"
echo "   - ac-data.log should show [player-join] notRegistered=true and [user-registration] marked"
echo "   - telemetry-data.log should show registration kick with chat warning"
echo ""
echo "Expected in-game: private chat warning, then kick ~${USER_NOT_REGISTERED_WARN_DELAY_SEC:-3}s later"
