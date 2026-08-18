#!/usr/bin/env bash
# Sample Convex HUD query counters over N minutes; fail if session/version drift exceeds threshold.
# Usage: ./scripts/verify-hud-idle-query-volume.sh [minutes] [max_delta_per_min]
#
# Requires: ac-data running, WSS client connected in-game (HUD_WS_ENABLED=true).
# Example: ./scripts/verify-hud-idle-query-volume.sh 10 0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/.env.local" 2>/dev/null || source "$ROOT/.env.production" 2>/dev/null || true

MINUTES="${1:-10}"
MAX_DELTA_PER_MIN="${2:-0}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing in env"
  exit 1
fi

fetch_stats() {
  curl -sfS "$BASE_URL/hud/worker/convex-query-stats" \
    -H "X-Worker-Secret: $SECRET"
}

read_counter() {
  local json="$1"
  local key="$2"
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('queries',{}).get('$key',0))" <<<"$json"
}

read_ws_connected() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wsConnected', d.get('streamConnected', 0)))" <<<"$1"
}

echo "=== HUD idle Convex query volume (${MINUTES} min, max_delta/min=${MAX_DELTA_PER_MIN}) ==="
echo "GET $BASE_URL/hud/worker/convex-query-stats"
echo ""

START_JSON="$(fetch_stats)"
START_SESSION="$(read_counter "$START_JSON" fetchHudSession)"
START_VERSION="$(read_counter "$START_JSON" fetchHudVersion)"
START_WS="$(read_ws_connected "$START_JSON")"

echo "T0: fetchHudSession=$START_SESSION fetchHudVersion=$START_VERSION wsConnected=$START_WS"

if [[ "$START_WS" -lt 1 ]]; then
  echo "WARN: no WSS clients connected — connect in-game before idle test"
fi

INTERVAL_SEC=60
SAMPLES="$MINUTES"
FAIL=0

for ((i=1; i<=SAMPLES; i++)); do
  sleep "$INTERVAL_SEC"
  NOW_JSON="$(fetch_stats)"
  NOW_SESSION="$(read_counter "$NOW_JSON" fetchHudSession)"
  NOW_VERSION="$(read_counter "$NOW_JSON" fetchHudVersion)"
  NOW_WS="$(read_ws_connected "$NOW_JSON")"
  D_SESSION=$((NOW_SESSION - START_SESSION))
  D_VERSION=$((NOW_VERSION - START_VERSION))
  echo "T+${i}m: session=${NOW_SESSION} (+${D_SESSION}) version=${NOW_VERSION} (+${D_VERSION}) wsConnected=${NOW_WS}"
  if [[ "$i" -gt 0 ]]; then
    SESSION_PER_MIN=$((D_SESSION / i))
    VERSION_PER_MIN=$((D_VERSION / i))
    if [[ "$SESSION_PER_MIN" -gt "$MAX_DELTA_PER_MIN" || "$VERSION_PER_MIN" -gt "$MAX_DELTA_PER_MIN" ]]; then
      echo "FAIL: periodic session/version polling detected (>${MAX_DELTA_PER_MIN}/min)"
      FAIL=1
    fi
  fi
done

END_JSON="$(fetch_stats)"
END_SESSION="$(read_counter "$END_JSON" fetchHudSession)"
END_VERSION="$(read_counter "$END_JSON" fetchHudVersion)"
TOTAL_D_SESSION=$((END_SESSION - START_SESSION))
TOTAL_D_VERSION=$((END_VERSION - START_VERSION))

echo ""
echo "Summary (${MINUTES} min): fetchHudSession +${TOTAL_D_SESSION}, fetchHudVersion +${TOTAL_D_VERSION}"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi

if [[ "$MAX_DELTA_PER_MIN" -eq 0 && ( "$TOTAL_D_SESSION" -gt 2 || "$TOTAL_D_VERSION" -gt 1 ) ]]; then
  echo "FAIL: idle drift exceeds tolerance (session>2 or version>1 over full window)"
  exit 1
fi

echo "OK: idle Convex HUD query volume within tolerance"
