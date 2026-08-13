#!/usr/bin/env bash
# Live mid-session push sync checklist: Redis keys + refresh-user + log hints.
# Usage: ./scripts/verify-push-sync-live.sh STEAM_ID [reason]
#   reason: invalidated | revalidated | registered | prefs | cosmetics  (default: invalidated)
#
# Run while the player is CONNECTED in-game. If this works but web actions do not,
# Convex is not calling POST /hud/worker/refresh-user — see docs/CONVEX_PUSH_USER_SYNC.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/.env.local" 2>/dev/null || source "$ROOT/.env.production" 2>/dev/null || true

STEAM_ID="${1:-}"
REASON="${2:-invalidated}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

BAN_PREFIX="${USER_INVALIDATED_REDIS_PREFIX:-ac:user:invalidated:}"
NOT_REG_PREFIX="${USER_NOT_REGISTERED_REDIS_PREFIX:-ac:user:not_registered:}"
PREFS_SAVE_PREFIX="${USER_PREFS_SAVE_TIME_PREFIX:-ac:user:prefs:save_time:}"
PREFS_BATTLE_PREFIX="${USER_PREFS_ACCEPT_BATTLE_PREFIX:-ac:user:prefs:accept_battle:}"
COSMETICS_FP_PREFIX="${USER_PROFILE_COSMETICS_FP_PREFIX:-ac:user:profile:cosmetics_fp:}"

REDIS_ARGS=()
if [[ -n "${REDIS_HOST:-}" ]]; then
  REDIS_ARGS+=(-h "$REDIS_HOST")
fi
if [[ -n "${REDIS_PORT:-}" ]]; then
  REDIS_ARGS+=(-p "$REDIS_PORT")
fi
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  REDIS_ARGS+=(-a "$REDIS_PASSWORD")
fi

redis_get() {
  redis-cli "${REDIS_ARGS[@]}" GET "$1" 2>/dev/null || echo "(redis unavailable)"
}

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 STEAM_ID [reason]"
  echo "  reason: invalidated | revalidated | registered | prefs | cosmetics"
  exit 1
fi

if [[ -z "$SECRET" ]]; then
  echo "CONVEX_WORKER_SECRET missing in env"
  exit 1
fi

echo "=== Mid-session push sync live check ==="
echo "steamId=$STEAM_ID reason=$REASON"
echo ""

echo "--- Redis BEFORE refresh-user ---"
echo "  ban:           ${BAN_PREFIX}${STEAM_ID} = $(redis_get "${BAN_PREFIX}${STEAM_ID}")"
echo "  not_registered:${NOT_REG_PREFIX}${STEAM_ID} = $(redis_get "${NOT_REG_PREFIX}${STEAM_ID}")"
echo "  saveTime:      ${PREFS_SAVE_PREFIX}${STEAM_ID} = $(redis_get "${PREFS_SAVE_PREFIX}${STEAM_ID}")"
echo "  acceptBattle:  ${PREFS_BATTLE_PREFIX}${STEAM_ID} = $(redis_get "${PREFS_BATTLE_PREFIX}${STEAM_ID}")"
echo "  cosmetics_fp:  ${COSMETICS_FP_PREFIX}${STEAM_ID} = $(redis_get "${COSMETICS_FP_PREFIX}${STEAM_ID}")"
echo ""

echo "--- POST $BASE_URL/hud/worker/refresh-user (publishEnforcement=true) ---"
HTTP_CODE=$(curl -sS -o /tmp/verify-push-sync-body.txt -w "%{http_code}" \
  -X POST "$BASE_URL/hud/worker/refresh-user" \
  -H "Content-Type: application/json" \
  -d "{\"workerSecret\":\"$SECRET\",\"steamId\":\"$STEAM_ID\",\"reason\":\"$REASON\"}")

cat /tmp/verify-push-sync-body.txt
echo ""
echo "HTTP $HTTP_CODE"
echo ""

if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "204" ]]; then
  echo "FAIL: refresh-user returned HTTP $HTTP_CODE"
  echo "Check CONVEX_WORKER_SECRET, ac-data bind (AC_DATA_BIND_HOST), and Caddy for $BASE_URL"
  exit 1
fi

echo "--- Redis AFTER refresh-user ---"
echo "  ban:           $(redis_get "${BAN_PREFIX}${STEAM_ID}")"
echo "  not_registered:$(redis_get "${NOT_REG_PREFIX}${STEAM_ID}")"
echo "  saveTime:      $(redis_get "${PREFS_SAVE_PREFIX}${STEAM_ID}")"
echo "  acceptBattle:  $(redis_get "${PREFS_BATTLE_PREFIX}${STEAM_ID}")"
echo "  cosmetics_fp:  $(redis_get "${COSMETICS_FP_PREFIX}${STEAM_ID}")"
echo ""

echo "--- Expected in-game (player must be connected) ---"
case "$REASON" in
  invalidated)
    echo "  • Private ban warning chat, then kick ~3s on all servers"
    echo "  • ac-data.log: [player-join] publishEnforcement=true invalidated=true"
    echo "  • telemetry-data.log: ban kick / user_invalidated_mid_session"
    ;;
  revalidated)
    echo "  • Ban key cleared; no kick if player was not banned"
    echo "  • ac-data.log: publishEnforcement=true invalidated=false"
    ;;
  registered)
    echo "  • not_registered key cleared; welcome chat if key existed before"
    echo "  • ac-data.log: [user-registration] welcome notify"
    echo "  • telemetry-data.log: registration welcome chat"
    ;;
  prefs)
    echo "  • Private chat for each pref that changed (acceptBattle / saveTime)"
    echo "  • ac-data.log: [user-prefs] notify pref=..."
    echo "  • telemetry-data.log: pref chat steamId=..."
    ;;
  cosmetics)
    echo "  • HUD overlay updates display_style / frame_url via SSE (no chat)"
    echo "  • ac-data.log: [profile-cosmetics] changed=true when fingerprint differs"
    echo "  • ac-data.log: [hud-user-status] cosmetics refresh"
    echo "  • Change frame/style in web while connected — HUD should update without reconnect"
    ;;
  *)
    echo "  • Unknown reason; check ac-data.log for publishEnforcement=true"
    ;;
esac
echo ""

echo "--- Log tail hints ---"
echo "  tail -f $ROOT/ac-data.log | grep -E 'player-join|user-prefs|user-registration|profile-cosmetics|hud-user-status'"
echo "  tail -f $ROOT/telemetry-data.log | grep -E 'pref chat|registration welcome|ban kick|invalidated'"
echo ""

echo "OK — if manual refresh works but web admin does not, deploy Convex notifyAcDataHudRefresh"
echo "     and set AC_DATA_BASE_URL in Convex dashboard (public URL, not 127.0.0.1)."
echo "See docs/CONVEX_PUSH_USER_SYNC.md troubleshooting section."
