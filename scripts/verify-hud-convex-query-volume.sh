#!/usr/bin/env bash
# Read ac-data in-process Convex HUD query counters + correlate with live WSS connections.
# Usage: ./scripts/verify-hud-convex-query-volume.sh
#
# Optional: enable periodic logs in ac-data
#   HUD_CONVEX_QUERY_LOG_INTERVAL_MS=60000  # log every 60s to ac-data.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/.env.local" 2>/dev/null || source "$ROOT/.env.production" 2>/dev/null || true

BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing in env"
  exit 1
fi

echo "=== ac-data Convex HUD query stats (since process start) ==="
echo "GET $BASE_URL/hud/worker/convex-query-stats"
echo ""

curl -sfS "$BASE_URL/hud/worker/convex-query-stats" \
  -H "X-Worker-Secret: $SECRET" 2>/dev/null | python3 -m json.tool 2>/dev/null || {
  echo "WARN: endpoint unavailable (404?) — restart ac-data after deploy to load GET /hud/worker/convex-query-stats"
  curl -sS "$BASE_URL/hud/worker/convex-query-stats?workerSecret=$SECRET" || true
  echo ""
  exit 0
}

echo ""
echo ""
echo "Correlate spikes in Convex dashboard with:"
echo "  - fetchHudSession / fetchHudVersion counts above"
echo "  - streamConnected / wsConnected (HUD WSS clients on this ac-data instance)"
echo "  - lap_completed bursts → [hud-refresh] in ac-data.log"
echo "  - overlay poll mode → GET /hud/snapshot every 1-5s per client"
echo ""
echo "Enable periodic logging: HUD_CONVEX_QUERY_LOG_INTERVAL_MS=60000 in .env.local"
echo "Stable version check: ./scripts/verify-convex-hud-version-stable.sh STEAM_ID"
