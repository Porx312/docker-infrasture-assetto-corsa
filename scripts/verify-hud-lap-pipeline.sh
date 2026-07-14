#!/usr/bin/env bash
# Trace lap_completed → Redis → ac-data hud-refresh during a valid lap.
# Usage: ./scripts/verify-hud-lap-pipeline.sh [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEAM_ID="${1:-76561199230780195}"
TELEMETRY_LOG="${ROOT}/telemetry-data.log"
AC_DATA_LOG="${ROOT}/ac-data.log"

echo "=== HUD lap pipeline check (steamId=${STEAM_ID}) ==="
echo

echo "-- Redis stream (last lap_completed in last 5000 events) --"
LAP_COUNT=$(redis-cli XREVRANGE ac:events + - COUNT 5000 2>/dev/null | rg -c '"event":"lap_completed"' || echo 0)
echo "lap_completed in last 5000: ${LAP_COUNT}"

echo
echo "-- XPENDING ac:events --"
redis-cli XPENDING ac:events ac-data-consumers 2>/dev/null || echo "(redis unavailable)"

echo
echo "-- Recent telemetry laps (last 5) --"
rg "lap valid|lap invalid|lap ignored" "${TELEMETRY_LOG}" 2>/dev/null | tail -5 || echo "(none)"

echo
echo "-- Recent hud-refresh / ingest errors (last 10) --"
rg "hud-refresh|convex batch ingest|flush error" "${AC_DATA_LOG}" 2>/dev/null | tail -10 || echo "(none)"

echo
echo "-- HUD session cache for player --"
redis-cli GET "ac:hud:session:${STEAM_ID}" 2>/dev/null | head -c 500 || echo "(empty)"
echo

echo
echo "Live trace (Ctrl+C to stop). Complete a valid lap on testing xd:"
echo "  tail -f ${TELEMETRY_LOG} | rg 'lap valid|lap invalid'"
echo "  tail -f ${AC_DATA_LOG} | rg 'hud-refresh|flush error'"
