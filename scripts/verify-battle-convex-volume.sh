#!/usr/bin/env bash
# Measure fetchHudSession delta during a simulated battle prep cycle.
# Requires ac-data running and Redis configured.
#
# Usage:
#   ./scripts/verify-battle-convex-volume.sh [p1_steam] [p2_steam]
#   ./scripts/verify-battle-convex-volume.sh --max-delta 4
#   ./scripts/verify-battle-convex-volume.sh --skip-sim   # stats only (manual battle)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1090
source "${ASSETTO_ENV_FILE:-$ROOT/.env.local}" 2>/dev/null || source "$ROOT/.env.local" 2>/dev/null || true

BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"
MAX_DELTA="${HUD_BATTLE_CONVEX_MAX_DELTA:-4}"
SKIP_SIM=0
P1="76561199230780195"
P2="76561198706313764"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-delta) MAX_DELTA="$2"; shift 2 ;;
    --skip-sim) SKIP_SIM=1; shift ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    --*) echo "Unknown arg: $1"; exit 1 ;;
    *)
      if [[ -z "${P1_SET:-}" ]]; then P1="$1"; P1_SET=1
      elif [[ -z "${P2_SET:-}" ]]; then P2="$1"; P2_SET=1
      else echo "Unexpected arg: $1"; exit 1
      fi
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

read_delta() {
  python3 - "$1" "$2" <<'PY'
import json, sys
before = json.loads(sys.argv[1])
after = json.loads(sys.argv[2])
bq = before.get("queries") or {}
aq = after.get("queries") or {}
session_before = int(bq.get("fetchHudSession") or 0)
session_after = int(aq.get("fetchHudSession") or 0)
print(session_after - session_before)
PY
}

echo "=== Battle Convex volume check ==="
echo "Base URL: $BASE_URL"
echo "Max allowed fetchHudSession delta: $MAX_DELTA"
echo ""

BEFORE="$(fetch_stats)"
SESSION_BEFORE="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('queries',{}).get('fetchHudSession',0))" "$BEFORE")"
echo "Baseline fetchHudSession: $SESSION_BEFORE"

if [[ "$SKIP_SIM" -eq 0 ]]; then
  echo ""
  echo "Running simulate-battle-complete.sh --fast --skip-stream ..."
  "$ROOT/scripts/simulate-battle-complete.sh" "$P1" "$P2" --fast --skip-stream
fi

AFTER="$(fetch_stats)"
SESSION_AFTER="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('queries',{}).get('fetchHudSession',0))" "$AFTER")"
DELTA="$(read_delta "$BEFORE" "$AFTER")"

echo ""
echo "After fetchHudSession: $SESSION_AFTER"
echo "Delta fetchHudSession: $DELTA"

LOG_FILE="$ROOT/ac-data.log"
if [[ -f "$LOG_FILE" ]]; then
  SNAPSHOT_COUNT="$(rg -c '\[hud-snapshot\].*sections=battle' "$LOG_FILE" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')"
  ENRICH_COUNT="$(rg -c '\[battle-enrich\]' "$LOG_FILE" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')"
  echo "Log lines [hud-snapshot] sections=battle (lifetime file): ${SNAPSHOT_COUNT:-0}"
  echo "Log lines [battle-enrich] (lifetime file): ${ENRICH_COUNT:-0}"
fi

echo ""
if [[ "$DELTA" -le "$MAX_DELTA" ]]; then
  echo "PASS: fetchHudSession delta $DELTA <= $MAX_DELTA"
  exit 0
fi

echo "FAIL: fetchHudSession delta $DELTA > $MAX_DELTA"
exit 1
