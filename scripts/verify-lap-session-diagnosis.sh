#!/usr/bin/env bash
# Diagnose lap_completed pipeline + registration state for a player session.
# Usage: ./scripts/verify-lap-session-diagnosis.sh [steamId] [playerNameSubstring]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-}"
NAME_HINT="${2:-}"

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

echo "=== Lap session diagnosis ==="
echo "steamId=${STEAM_ID:-<none>} nameHint=${NAME_HINT:-<none>}"
echo ""

if [[ -n "$STEAM_ID" ]]; then
  echo "1) Redis registration / saveTime flags"
  redis-cli "${REDIS_ARGS[@]}" GET "ac:user:not_registered:${STEAM_ID}" || true
  redis-cli "${REDIS_ARGS[@]}" GET "ac:user:prefs:save_time:${STEAM_ID}" || true
  echo ""

  echo "2) Recent lap_completed events in ac:events (last 50)"
  redis-cli "${REDIS_ARGS[@]}" XREVRANGE ac:events + - COUNT 50 2>/dev/null | grep -F "$STEAM_ID" | grep -F lap_completed || echo "   (no lap_completed for steamId in last 50 stream entries)"
  echo ""
fi

PATTERN='lap_completed|lap valid|lap_completed SKIPPED|hud-lap-post-ingest|lap_completed forward|lap_completed localOnly|player-join-timing|CLIENT_LOADED regCheck|CAR_UPDATE not registered|registration cleared'
if [[ -n "$STEAM_ID" ]]; then
  PATTERN="${STEAM_ID}|${PATTERN}"
elif [[ -n "$NAME_HINT" ]]; then
  PATTERN="${NAME_HINT}|${PATTERN}"
fi

echo "3) Log grep (telemetry-data.log + ac-data.log)"
grep -E "$PATTERN" "${ROOT}/telemetry-data.log" "${ROOT}/ac-data.log" 2>/dev/null | tail -40 || echo "   (no matches)"
echo ""
echo "Done."
