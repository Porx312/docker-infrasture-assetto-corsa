#!/usr/bin/env bash
# Correlate player_join events with HUD Convex query volume and fan-out signals.
# Usage: ./scripts/verify-join-hud-fanout.sh [steamId] [logFile]
#
# Interprets ac-data.log + in-process convex-query-stats to classify JOIN fan-out:
#   - JOIN-only (O(1)): [player-join] for one steamId, no rival-fanout / no N refresh-user lines
#   - Convex webhook fan-out: N [hud-user-status] live session refresh with distinct steamIds
#   - ac-data rival fan-out: [hud-rival-fanout] refreshed=N
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-76561199230780195}"
LOG_FILE="${2:-${ROOT}/ac-data.log}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

echo "=== JOIN HUD fan-out investigation ==="
echo "steamId=${STEAM_ID}"
echo "log=${LOG_FILE}"
echo ""

if [[ ! -f "$LOG_FILE" ]]; then
  echo "WARN: log file missing: $LOG_FILE"
else
  echo "--- [player-join] for steamId (last 10) ---"
  grep "\[player-join\] steamId=${STEAM_ID}" "$LOG_FILE" 2>/dev/null | tail -10 || true

  echo ""
  echo "--- [player-join] counts (all steamIds, last 50 lines) ---"
  grep '\[player-join\]' "$LOG_FILE" 2>/dev/null | tail -50 | sed -n 's/.*steamId=\([^ ]*\).*/\1/p' | sort | uniq -c | sort -rn || true

  echo ""
  echo "--- [hud-rival-fanout] (O(N) ac-data loop; NOT expected on pure JOIN) ---"
  grep '\[hud-rival-fanout\]' "$LOG_FILE" 2>/dev/null | tail -10 || true

  echo ""
  echo "--- [hud-user-status] live session refresh (Convex refresh-user path) ---"
  grep '\[hud-user-status\] live session refresh' "$LOG_FILE" 2>/dev/null | tail -20 || true

  echo ""
  echo "--- Distinct steamIds in live refresh (last 200 lines) ---"
  REFRESH_COUNT="$(grep '\[hud-user-status\] live session refresh' "$LOG_FILE" 2>/dev/null | tail -200 \
    | sed -n 's/.*steamId=\([^ ]*\).*/\1/p' | sort -u | wc -l | tr -d ' ' || true)"
  echo "unique steamIds: ${REFRESH_COUNT:-0}"

  echo ""
  echo "--- [hud-worker] refresh-user failures ---"
  grep '\[hud-worker\].*refresh-user' "$LOG_FILE" 2>/dev/null | tail -10 || true
fi

echo ""
echo "--- In-process Convex HUD query stats (since ac-data start) ---"
if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing — skip stats endpoint"
else
  STATS="$(curl -sfS "${BASE_URL}/hud/worker/convex-query-stats" -H "X-Worker-Secret: $SECRET" 2>/dev/null || true)"
  if [[ -n "$STATS" ]]; then
    echo "$STATS" | python3 -m json.tool 2>/dev/null || echo "$STATS"
    echo ""
    python3 - <<'PY' "$STATS" || true
import json, sys
raw = sys.argv[1] if len(sys.argv) > 1 else ""
if not raw.strip():
    print("(empty stats)")
    sys.exit(0)
try:
    s = json.loads(raw)
except json.JSONDecodeError:
    print("Could not parse stats JSON")
    sys.exit(0)
q = s.get("queries", {})
join_ctx = int(q.get("fetchPlayerJoinContext", 0))
session = int(q.get("fetchHudSession", 0))
ws = int(s.get("wsConnected", s.get("streamConnected", 0)))
print(f"Ratio fetchHudSession/fetchPlayerJoinContext: {session}/{join_ctx}", end="")
if join_ctx:
    print(f" ({session/join_ctx:.1f}x)")
else:
    print(" (n/a)")
print(f"WSS connected now: {ws}")
if session > 0 and join_ctx > 0 and session >= max(10, ws) and session > join_ctx * 5:
    print("LIKELY: getHudSession volume >> join context — check Convex N× refresh-user or snapshot poll, not JOIN loop.")
elif join_ctx > 0 and session <= join_ctx * 2:
    print("LIKELY: JOIN path O(1) — getHudSession not fanning with connected count.")
PY
  else
    echo "Stats endpoint unavailable (is ac-data running?)"
  fi
fi

echo ""
echo "--- Interpretation ---"
echo "Pure player_join in ac-data is O(1): one getPlayerJoinContext(A), push only to A."
echo "N≈connected getHudSession usually means:"
echo "  1) Convex schedules N× POST /hud/worker/refresh-user (rival_pb/session) — fix in ProjectD ingest"
echo "  2) Mis-count: getPlayerJoinContext also builds session internally (not hud:getHudSession from ac-data)"
echo "  3) [hud-rival-fanout] if HUD_LAP_AC_DATA_REFRESH_ENABLED + lap scheduler (unwired today)"
echo ""
echo "Re-test live: rejoin once, then re-run this script within 30s."
echo "See docs/JOIN_HUD_FANOUT_INVESTIGATION.md"
