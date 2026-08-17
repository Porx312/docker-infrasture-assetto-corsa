#!/usr/bin/env bash
# End-to-end HUD registration diagnostics (overlay "Waiting for server registration…").
#
# Usage:
#   ./scripts/verify-hud-registration-pipeline.sh [steamId]
#
# Run while connected in-game for live checks. Without a player online, expect
# player_not_connected / server_not_found — that confirms the gate works.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEAM_ID="${1:-76561199230780195}"
ENV_FILE="${ASSETTO_ENV_FILE:-${ROOT}/.env.local}"
API_BASE="${STAGING_API_URL:-https://dev-api.projectd.space}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
rc() { redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" "$@"; }

echo "=== HUD registration pipeline ==="
echo "steamId: $STEAM_ID"
echo "API:     $API_BASE"
echo ""

# Overlay debug equivalent (battle_debug widgets)
PRESENCE="$(rc get "ac:hud:presence:${STEAM_ID}" 2>/dev/null || true)"
SSE_EXISTS="$(rc exists "ac:hud:sse:${STEAM_ID}" 2>/dev/null || echo 0)"
SNAPSHOT_HTTP="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "${API_BASE}/hud/snapshot?steamId=${STEAM_ID}&sections=session" 2>/dev/null || echo 000)"
SNAPSHOT_BODY="$(curl -sS -m 5 "${API_BASE}/hud/snapshot?steamId=${STEAM_ID}&sections=session" 2>/dev/null | head -c 200 || true)"

echo "=== Overlay debug equivalent ==="
if [[ -z "$PRESENCE" || "$PRESENCE" == "(nil)" ]]; then
  echo "modo:     error (or waiting for server bridge — not online yet)"
  echo "evento:   (none — WSS not connected yet)"
  echo "error:    player_not_connected"
  OVERLAY_HINT="Connect to a ProjectD server online, then retry."
elif [[ "$SNAPSHOT_HTTP" == "200" ]]; then
  echo "modo:     poll/wss"
  echo "evento:   (check WSS or snapshot for hud_session / hud_error)"
  echo "error:    (none at HTTP layer — wait for hud_session)"
  OVERLAY_HINT="If still 'Waiting for server registration', transport works but hud_session pending."
else
  echo "modo:     connecting"
  echo "evento:   (none yet)"
  echo "error:    HTTP ${SNAPSHOT_HTTP} — ${SNAPSHOT_BODY}"
  OVERLAY_HINT="Fix HTTP/WSS before expecting hud_session."
fi
echo "hint:     $OVERLAY_HINT"
echo ""

echo "=== Redis ==="
echo "ac:hud:presence:${STEAM_ID}:"
if [[ -n "$PRESENCE" && "$PRESENCE" != "(nil)" ]]; then
  echo "$PRESENCE"
else
  echo "(missing — telemetry has not registered this player)"
fi
echo "ac:hud:sse:${STEAM_ID} EXISTS=$SSE_EXISTS (overlay WSS keepalive or snapshot poll renews this key)"
echo ""

echo "=== Convex getHudSession ==="
"${ROOT}/scripts/verify-convex-hud-session.sh" "$STEAM_ID" 2>&1 | tail -20
echo ""

echo "=== Telemetry UDP listeners ==="
if pgrep -f "python3 main.py" >/dev/null 2>&1; then
  echo "OK: telemetry-data running"
  ss -ulnp 2>/dev/null | grep -E "python3.*120[0-9]{2}" | head -5 || true
else
  echo "FAIL: telemetry-data not running — ./start.sh dev"
fi
echo ""

echo "=== Recent player_join (ac:events) ==="
rc xrevrange ac:events + - COUNT 100 2>/dev/null | grep -E "player_join|${STEAM_ID}" | head -8 || echo "(none recent)"
echo ""

echo "=== Ingest PEL (XPENDING) ==="
XPENDING_SUMMARY="$(rc XPENDING ac:events ac-data-consumers 2>/dev/null || true)"
if [[ -n "$XPENDING_SUMMARY" ]]; then
  PENDING_COUNT="$(echo "$XPENDING_SUMMARY" | head -1 | tr -d ' ')"
  echo "pending_count: ${PENDING_COUNT:-?}"
  echo "$XPENDING_SUMMARY" | head -5
  if [[ -n "${PENDING_COUNT:-}" && "$PENDING_COUNT" =~ ^[0-9]+$ && "$PENDING_COUNT" -gt 1000 ]]; then
    echo "WARN: large XPENDING backlog — run ./scripts/clear-ingest-pending.sh dev --apply --all"
  fi
else
  echo "(XPENDING unavailable)"
fi
echo ""

echo "=== Interpretation ==="
cat <<EOF
| Check                         | OK when |
|-------------------------------|---------|
| ac:hud:presence               | JSON with serverName/track while in server |
| SSE HTTP 200                  | Opens stream (not 404 player_not_connected) |
| Convex session ok             | rank/elo/profile in getHudSession |
| XPENDING ac-data-consumers    | near 0; if >1000 run clear-ingest-pending.sh |
| hud_session in SSE            | ./scripts/verify-hud-overlay-contract.sh $STEAM_ID (or HUD_HOST=dev-api.projectd.space ...) |

If SSE shows \`hud_error\` with \`server_not_found\` but presence exists, ac-data retries
\`getHudSession\` up to \`HUD_SESSION_FETCH_RETRY_ATTEMPTS\` (default 3). Persistent failure
means Convex \`live_players\` has no row — rejoin the server or check ingest logs.

Enable in-game debug: ac.storage("ProjectD-HUD:battle_debug", true):set()
EOF
