#!/usr/bin/env bash
# Read-only audit helper: lap_completed vs getHudSession burst correlation.
# Usage: ./scripts/verify-hud-lap-session-audit.sh [ac-data.log]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/.env.local" 2>/dev/null || source "$ROOT/.env.production" 2>/dev/null || true

LOG_FILE="${1:-$ROOT/ac-data.log}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

echo "=== HUD getHudSession / lap_completed audit ==="
echo ""

echo "--- Env (effective) ---"
HUD_LAP="${HUD_LAP_AC_DATA_REFRESH_ENABLED:-false (default)}"
echo "HUD_LAP_AC_DATA_REFRESH_ENABLED=${HUD_LAP}"
echo "HUD_WS_ENABLED=${HUD_WS_ENABLED:-(unset)}"
echo "HUD_WS_KEEPALIVE_MS=${HUD_WS_KEEPALIVE_MS:-30000 (default)}"
echo "HUD_SESSION_TTL_SEC=${HUD_SESSION_TTL_SEC:-300 (default)}"
echo "AC_INSTANCE_ID=${AC_INSTANCE_ID:-default}"
echo "CONVEX_DEPLOYMENT_URL=${CONVEX_DEPLOYMENT_URL:-(unset)}"
echo ""

if [[ -f "$LOG_FILE" ]]; then
  echo "--- Log counts ($LOG_FILE) ---"
  REFRESH_USER=$(grep -c '\[hud-worker\] refresh-user' "$LOG_FILE" 2>/dev/null || true)
  HUD_REFRESH=$(grep -c '\[hud-refresh\]' "$LOG_FILE" 2>/dev/null || true)
  LAP_POST=$(grep -c '\[hud-lap-post-ingest\]' "$LOG_FILE" 2>/dev/null || true)
  PUSH_FETCH=$(grep -c '\[hud-push\] fetchHudSession' "$LOG_FILE" 2>/dev/null || true)
  KEEPALIVE_MISS=$(grep -c '\[hud-ws-keepalive\].*cache=miss' "$LOG_FILE" 2>/dev/null || true)
  echo "refresh-user webhooks:     ${REFRESH_USER:-0}"
  echo "hud-refresh (battle/lap):  ${HUD_REFRESH:-0}"
  echo "hud-lap-post-ingest:       ${LAP_POST:-0}"
  echo "hud-push fetchHudSession:  ${PUSH_FETCH:-0}"
  echo "hud-ws-keepalive miss:     ${KEEPALIVE_MISS:-0}"
  echo ""
  echo "--- Recent refresh-user (last 5) ---"
  grep '\[hud-worker\] refresh-user' "$LOG_FILE" 2>/dev/null | tail -5 || echo "(none)"
  echo ""
  echo "--- Recent hud-refresh (last 3) ---"
  grep '\[hud-refresh\]' "$LOG_FILE" 2>/dev/null | tail -3 || echo "(none)"
else
  echo "Log file not found: $LOG_FILE"
fi

echo ""
if [[ -n "$SECRET" ]]; then
  echo "--- convex-query-stats ---"
  STATS="$(curl -sfS "$BASE_URL/hud/worker/convex-query-stats" -H "X-Worker-Secret: $SECRET" 2>/dev/null || echo '{}')"
  echo "$STATS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
q=d.get('queries',{})
ws=d.get('wsConnected',0)
sess=q.get('fetchHudSession',0)
join=q.get('fetchPlayerJoinContext',0)
ver=q.get('fetchHudVersion',0)
print(f'wsConnected={ws} fetchHudSession={sess} fetchPlayerJoinContext={join} fetchHudVersion={ver}')
if ws > 0 and sess > ws * 2:
    print('LIKELY: session fetches >> WSS clients — check keepalive (pre peekSessionCache) or mass refresh-user')
elif sess > 0 and join > 0 and sess <= join * 3:
    print('LIKELY: event-driven (webhooks/join), not O(N) idle burst')
else:
    print('Review logs: refresh-user vs hud-refresh vs keepalive miss')
"
else
  echo "CONVEX_WORKER_SECRET missing — skip stats endpoint"
fi

echo ""
echo "Code checks:"
if grep -q 'peekSessionCache' "$ROOT/ac-data/src/services/hud/hudWs.ts" 2>/dev/null; then
  echo "  peekSessionCache in hudWs keepalive: YES"
else
  echo "  peekSessionCache in hudWs keepalive: NO (deploy keepalive fix)"
fi
CALLERS=$(grep -rl 'scheduleHudRefreshAfterLap' "$ROOT/ac-data/src" --include='*.ts' 2>/dev/null | grep -v '\.test\.' | grep -v 'hudRefreshScheduler\.ts' || true)
if [[ -z "$CALLERS" ]]; then
  echo "  scheduleHudRefreshAfterLap production callers: NONE (legacy unwired)"
else
  echo "  scheduleHudRefreshAfterLap production callers: $CALLERS"
fi

echo ""
echo "See docs/HUD_GETHUDSESSION_LAP_AUDIT.md for full report."
