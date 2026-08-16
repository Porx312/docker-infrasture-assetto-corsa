#!/usr/bin/env bash
# Verify event-driven rival PB fan-out: local Redis patch + SSE without Convex for observers.
#
# Usage:
#   ./scripts/verify-hud-rival-fanout.sh [observerSteamId] [rivalSteamId] [lapMs]
#
# Example (observer prox, rival porx PB):
#   ./scripts/verify-hud-rival-fanout.sh 76561199230780195 76561199150078952 274000
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OBSERVER_ID="${1:-76561199230780195}"
RIVAL_ID="${2:-76561199150078952}"
LAP_MS="${3:-274000}"

AC_DATA_LOG="${ROOT}/ac-data.log"

echo "=== HUD rival fan-out check ==="
echo "observer=${OBSERVER_ID} rival=${RIVAL_ID} lapMs=${LAP_MS}"
echo

if ! pgrep -af "tsx src/index" >/dev/null 2>&1 && ! pgrep -af "node dist/index" >/dev/null 2>&1; then
  echo "WARN: ac-data does not appear to be running"
fi

echo "-- Recent hud-rival-fanout / hud-refresh lines --"
rg "hud-rival-fanout|hud-refresh" "${AC_DATA_LOG}" 2>/dev/null | tail -15 || echo "(none)"

echo
echo "-- Simulate rival PB (requires overlay SSE connected for observer) --"
echo "  Terminal 1: curl -N 'http://127.0.0.1:3000/hud/stream?steamId=${OBSERVER_ID}'"
echo "  Terminal 2: ./scripts/simulate-lap-completed.sh ${RIVAL_ID} --lap-ms ${LAP_MS} --watch-sse"
echo
echo "Expected ac-data log after ~2-3s:"
echo "  [hud-rival-fanout] ... local=1 convex=0  (observer rank unchanged, rival slot patched)"
echo "  OR convex=1 if rival PB may reorder rank"
echo
echo "Expected observer SSE: hud_session with rivals.above/below lap_ms updated"
echo
echo "Convex volume (should NOT spike for observer on local-only fanout):"
echo "  ./scripts/verify-hud-convex-query-volume.sh"
