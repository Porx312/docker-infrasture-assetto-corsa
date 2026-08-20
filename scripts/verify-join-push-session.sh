#!/usr/bin/env bash
# Verify join + push-only: simulated join context + 3 battle cycles → fetchHudSession delta 0.
#
# Usage:
#   ./scripts/verify-join-push-session.sh [steamId]
#   ./scripts/verify-join-push-session.sh --battles 3
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1090
source "${ASSETTO_ENV_FILE:-$ROOT/.env.local}" 2>/dev/null || source "$ROOT/.env.local" 2>/dev/null || true

BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"
STEAM_ID="${1:-76561199230780195}"
P2="76561198706313764"
BATTLES=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --battles) BATTLES="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,8p' "$0"
      exit 0
      ;;
    --*) echo "Unknown arg: $1"; exit 1 ;;
    *)
      STEAM_ID="$1"
      shift
      ;;
  esac
done

if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing in env"
  exit 1
fi

fetch_stats() {
  curl -sf -H "X-Worker-Secret: $SECRET" "$BASE_URL/hud/worker/convex-query-stats"
}

session_count() {
  python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('queries',{}).get('fetchHudSession',0))" "$1"
}

echo "=== Join + push-only session check ==="
echo "Base URL: $BASE_URL"
echo "Steam ID: $STEAM_ID"
echo "Battle cycles: $BATTLES"
echo ""

BEFORE="$(fetch_stats)"
SESSION_BEFORE="$(session_count "$BEFORE")"
echo "Baseline fetchHudSession: $SESSION_BEFORE"

echo ""
echo "Simulating worker refresh-user (join context) ..."
curl -sf -X POST "$BASE_URL/hud/worker/refresh-user" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: $SECRET" \
  -d "{\"workerSecret\":\"$SECRET\",\"steamId\":\"$STEAM_ID\",\"reason\":\"session\"}" >/dev/null

for ((i = 1; i <= BATTLES; i++)); do
  echo "Battle cycle $i/$BATTLES ..."
  "$ROOT/scripts/simulate-battle-complete.sh" "$STEAM_ID" "$P2" --fast --skip-stream
done

AFTER="$(fetch_stats)"
SESSION_AFTER="$(session_count "$AFTER")"
DELTA=$((SESSION_AFTER - SESSION_BEFORE))

echo ""
echo "After fetchHudSession: $SESSION_AFTER"
echo "Delta fetchHudSession: $DELTA"

if [[ "$DELTA" -le 0 ]]; then
  echo "PASS: fetchHudSession delta $DELTA <= 0 (join + push-only)"
  exit 0
fi

echo "FAIL: fetchHudSession delta $DELTA > 0"
exit 1
