#!/usr/bin/env bash
# Verify Convex-driven rival PB push: Convex schedules refresh-user → ac-data SSE.
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

echo "=== HUD rival / lap push check (Convex → refresh-user) ==="
echo "observer=${OBSERVER_ID} rival=${RIVAL_ID} lapMs=${LAP_MS}"
echo

if ! pgrep -af "tsx src/index" >/dev/null 2>&1 && ! pgrep -af "node dist/index" >/dev/null 2>&1; then
  echo "WARN: ac-data does not appear to be running"
fi

echo "-- Overlay poll: session in competition, battle when live --"
if rg -q 'needs_battle_snapshot_sections' ProjectD-HUD/common/api/session_snapshot.lua \
  && rg -q 'return "session"' ProjectD-HUD/common/api/session_snapshot.lua; then
  echo "OK: hybrid poll (session competition + battle backup)"
else
  echo "FAIL: expected hybrid snapshot_sections"
  exit 1
fi

echo
echo "-- Recent refresh-user / hud-user-status lines --"
rg "refresh-user|hud-user-status|hud-refresh" "${AC_DATA_LOG}" 2>/dev/null | tail -15 || echo "(none)"

echo
echo "-- Manual push (while Convex lap webhook not deployed) --"
echo "  ./scripts/verify-push-sync-live.sh ${OBSERVER_ID} rival_pb"
echo
echo "-- Simulate rival PB (Convex should push rival_pb to observers) --"
echo "  ./scripts/simulate-lap-completed.sh ${RIVAL_ID} --lap-ms ${LAP_MS}"
echo
echo "Expected ac-data log:"
echo "  [hud-worker] refresh-user ... reason=rival_pb (from Convex)"
echo "  [hud-user-status] ... reason=rival_pb (Redis cache updated even if sseListeners=0)"
echo "  [hud-snapshot] steamId=... sections=session (competition poll)"
echo "  [hud-snapshot] steamId=... sections=battle (during live battle only)"
echo
echo "See docs/CONVEX_LAP_HUD_PUSH.md and docs/CONVEX_PUSH_USER_SYNC.md"
