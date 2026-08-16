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

echo "-- Poll-only overlay (no SSE listeners) --"
echo "  Expect ac-data log: [hud-snapshot] ... sections=session (competition / post-battle)"
if rg -q 'return "session"' ProjectD-HUD/common/api/session_snapshot.lua 2>/dev/null; then
  echo "OK: snapshot_sections returns session outside live battle"
else
  echo "FAIL: snapshot_sections must return session for competition poll"
  exit 1
fi

echo
echo "-- Sanity: session snapshot API (requires HUD_API_KEY in .env.local) --"
if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a && source .env.local && set +a
fi
API_KEY="${HUD_API_KEY:-}"
PORT="${PORT:-3000}"
if [[ -n "$API_KEY" ]]; then
  SNAP_URL="http://127.0.0.1:${PORT}/hud/snapshot?steamId=${OBSERVER_ID}&sections=session&carFilter=global&api_key=${API_KEY}"
  echo "  curl -s '${SNAP_URL}' | head -c 400"
  if curl -sf "${SNAP_URL}" 2>/dev/null | head -c 400; then
    echo
    echo "OK: sections=session endpoint reachable"
  else
    echo "(WARN: snapshot request failed — check ac-data / presence)"
  fi
else
  echo "  SKIP: set HUD_API_KEY in .env.local to curl sections=session"
fi

echo
echo "-- Simulate rival PB --"
echo "  ./scripts/simulate-lap-completed.sh ${RIVAL_ID} --lap-ms ${LAP_MS}"
echo
echo "Expected ac-data log after ~2-3s:"
echo "  [hud-refresh-detail] rival author refresh"
echo "  [hud-snapshot] steamId=${OBSERVER_ID} sections=session (poll overlay)"
echo "  [hud-rival-fanout] ... local=1 convex=0  (if observer SSE connected + rival in window)"
echo
echo "Convex volume:"
echo "  ./scripts/verify-hud-convex-query-volume.sh"
