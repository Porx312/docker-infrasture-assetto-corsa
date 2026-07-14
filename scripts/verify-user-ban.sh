#!/usr/bin/env bash
# Simulate a global user ban in Redis and verify telemetry-data would kick on connect.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-76561199230780195}"
PREFIX="${USER_INVALIDATED_REDIS_PREFIX:-ac:user:invalidated:}"
CHANNEL="${USER_INVALIDATED_CHANNEL:-ac:user:invalidated}"
KEY="${PREFIX}${STEAM_ID}"
TTL="${USER_INVALIDATED_TTL_SEC:-86400}"

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "redis-cli not found" >&2
  exit 1
fi

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

echo "Setting ban key: ${KEY} (TTL ${TTL}s)"
redis-cli "${REDIS_ARGS[@]}" SET "$KEY" "1" EX "$TTL" >/dev/null

echo "Publishing kick signal on ${CHANNEL}"
redis-cli "${REDIS_ARGS[@]}" PUBLISH "$CHANNEL" "{\"steamId\":\"${STEAM_ID}\",\"ts\":$(date +%s000)}" >/dev/null

echo "Done. Connect with steamId ${STEAM_ID} and watch telemetry logs:"
echo "  tail -f ${ROOT}/telemetry-data.log | rg -i 'kick|invalidated|banned'"
