#!/usr/bin/env bash
# Diagnose Convex profile cosmetics → Redis fingerprint after player_join / refresh-user.
# Usage: ./scripts/verify-user-cosmetics.sh [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.env.local" 2>/dev/null || source "${ROOT}/.env.production" 2>/dev/null || true

STEAM_ID="${1:-76561199230780195}"
FP_PREFIX="${USER_PROFILE_COSMETICS_FP_PREFIX:-ac:user:profile:cosmetics_fp:}"
FP_KEY="${FP_PREFIX}${STEAM_ID}"
SESSION_KEY="ac:hud:session:${STEAM_ID}"

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

echo "=== User profile cosmetics: ${STEAM_ID} ==="
echo ""

echo "1) Convex getPlayerJoinContext (session.profile.display_style / frame_url)"
if [[ ! -f "${ROOT}/ac-data/dist/services/hud/hudConvex.js" ]]; then
  echo "   ac-data dist missing — run: cd ac-data && npm run build"
else
  if "${ROOT}/scripts/verify-convex-player-join.sh" "${STEAM_ID}" 2>&1; then
    echo "   OK: join query succeeded — check profile for display_style / frame_url in output"
  else
    echo "   WARN: deploy ProjectD with cosmetics on session.profile — see docs/CONVEX_PROFILE_COSMETICS.md"
  fi
fi
echo ""

echo "2) Redis cosmetics fingerprint: ${FP_KEY}"
FP_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${FP_KEY}" 2>/dev/null || true)"
if [[ -n "${FP_VALUE}" && "${FP_VALUE}" != "(nil)" ]]; then
  echo "   fingerprint: ${FP_VALUE}"
else
  echo "   (empty — connect in-game or run refresh-user to populate)"
fi
echo ""

echo "3) Redis HUD session cache: ${SESSION_KEY}"
SESSION_VALUE="$(redis-cli "${REDIS_ARGS[@]}" GET "${SESSION_KEY}" 2>/dev/null || true)"
if [[ -n "${SESSION_VALUE}" && "${SESSION_VALUE}" != "(nil)" ]]; then
  echo "${SESSION_VALUE}" | head -c 600
  echo ""
else
  echo "   (empty — connect in-game to trigger player_join)"
fi
echo ""

echo "4) GET /hud/profile-cosmetics-fp (Redis-only, no Convex)"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
HUD_KEY="${HUD_API_KEY:-}"
if [[ -n "${HUD_KEY}" ]]; then
  FP_HTTP="$(curl -sS "${BASE_URL}/hud/profile-cosmetics-fp?steamId=${STEAM_ID}&api_key=${HUD_KEY}" 2>/dev/null || true)"
  echo "   ${FP_HTTP}"
else
  echo "   Set HUD_API_KEY in env to test GET /hud/profile-cosmetics-fp"
fi
echo ""

echo "5) SSE connected clients (ac-data in-process)"
if [[ -n "${CONVEX_WORKER_SECRET:-}" ]]; then
  STATS="$(curl -sS -H "X-Worker-Secret: ${CONVEX_WORKER_SECRET}" "${BASE_URL}/hud/worker/convex-query-stats" 2>/dev/null || true)"
  echo "   ${STATS}"
  echo "   sseConnected>=1 in-game with HUD active → SSE push path; 0 → cosmetics_fp poll fallback"
else
  echo "   Set CONVEX_WORKER_SECRET to read convex-query-stats"
fi
echo ""

echo "6) Worker push refresh (immediate cosmetics sync)"
if [[ -n "${CONVEX_WORKER_SECRET:-}" ]]; then
  echo "   Run: ./scripts/verify-push-sync-live.sh ${STEAM_ID} cosmetics"
else
  echo "   Set CONVEX_WORKER_SECRET to test POST /hud/worker/refresh-user"
fi
echo ""

echo "7) Checklist"
echo "   - Fingerprint updates when display_style or frame_url changes"
echo "   - Mid-session: Convex schedules refresh-user with reason=cosmetics"
echo "   - Convex must bump session.version when cosmetics change"
echo "   - HUD overlay updates via SSE (no in-game chat)"
echo "   - ac-data.log: [profile-cosmetics] changed=true on worker push when cosmetics differ"
echo ""
echo "See docs/CONVEX_PROFILE_COSMETICS.md and docs/CONVEX_PUSH_USER_SYNC.md"
