#!/usr/bin/env bash
# Verify battle matchmaking HUD SSE gate (BATTLE_REQUIRE_HUD_SSE + ac:hud:sse:* keys).
#
# Usage:
#   ./scripts/verify-hud-sse-gate.sh              # env + unit tests
#   ./scripts/verify-hud-sse-gate.sh <steamId>    # also check Redis presence key
#
# With overlay connected to GET /hud/stream or polling GET /hud/snapshot,
# ac:hud:sse:{steamId} should exist (TTL ~45s, renewed each poll/SSE keepalive).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-${ROOT}/.env.local}"
STEAM_ID="${1:-}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

echo "=== HUD SSE battle gate ==="
echo "Env file: $ENV_FILE"
echo "BATTLE_REQUIRE_HUD_SSE=${BATTLE_REQUIRE_HUD_SSE:-<unset>}"
echo "HUD_SSE_PRESENCE_TTL_SEC=${HUD_SSE_PRESENCE_TTL_SEC:-45}"
echo "HUD_SSE_ENABLED=${HUD_SSE_ENABLED:-<unset>}"
echo ""

if [[ "${BATTLE_REQUIRE_HUD_SSE:-false}" != "true" ]]; then
  echo "WARN: BATTLE_REQUIRE_HUD_SSE is not true — matchmaking will NOT require overlay SSE."
  echo "Set BATTLE_REQUIRE_HUD_SSE=true in $ENV_FILE and restart telemetry-data."
else
  echo "OK: BATTLE_REQUIRE_HUD_SSE=true"
fi

echo ""
echo "=== Python unit tests (hud_sse_presence + matchmaking) ==="
cd "${ROOT}/telemetry-data"
python3 -m pytest -q tests/test_hud_sse_presence.py tests/battlesystem/test_matchmaking_hud_sse.py

if [[ -n "$STEAM_ID" ]]; then
  echo ""
  echo "=== Redis ac:hud:sse:${STEAM_ID} ==="
  PREFIX="${HUD_SSE_REDIS_PREFIX:-ac:hud:sse:}"
  KEY="${PREFIX}${STEAM_ID}"
  if command -v redis-cli >/dev/null 2>&1; then
    HOST="${REDIS_HOST:-127.0.0.1}"
    PORT="${REDIS_PORT:-6379}"
    EXISTS="$(redis-cli -h "$HOST" -p "$PORT" EXISTS "$KEY" 2>/dev/null || echo 0)"
    TTL="$(redis-cli -h "$HOST" -p "$PORT" TTL "$KEY" 2>/dev/null || echo -2)"
    echo "EXISTS=$EXISTS TTL=${TTL}s (key=$KEY)"
    if [[ "$EXISTS" == "1" ]]; then
      echo "OK: overlay presence active for $STEAM_ID (SSE or snapshot poll)"
    else
      echo "MISSING: open ProjectD HUD (SSE /hud/stream or poll /hud/snapshot?steamId=$STEAM_ID)"
    fi
  else
    echo "redis-cli not found — skip Redis check"
  fi
fi

echo ""
echo "Done."
