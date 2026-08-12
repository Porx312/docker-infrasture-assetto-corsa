#!/usr/bin/env bash
# Battle HUD end-to-end checks: SSE stream, Redis keys, pub/sub channel.
# Usage: ./scripts/verify-battle-pipeline.sh [steamId] [dev|prod]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STEAM_ID="${1:-}"
ENV_MODE="${2:-${ASSETTO_ENV:-dev}}"

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *) echo "Unknown mode: $ENV_MODE"; exit 1 ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi
# shellcheck source=lib/hud-steam-defaults.sh
source "$ROOT/scripts/lib/hud-steam-defaults.sh"
STEAM_ID="${1:-$HUD_DEFAULT_STEAM_ID}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 [steamId] [dev|prod]"
  echo "  default steamId: $HUD_DEFAULT_STEAM_ID"
  exit 1
fi

INSTANCE="${AC_INSTANCE_ID:-default}"
BASE_URL="${HUD_BASE_URL:-http://127.0.0.1:3000/hud}"
TIMEOUT_SEC="${HUD_VERIFY_TIMEOUT_SEC:-5}"

echo "=== Battle pipeline verify (instance=$INSTANCE) ==="
echo ""

echo "--- 1/4 Instance config ---"
"$ROOT/scripts/verify-vps-instance-config.sh" "$ENV_MODE" || true
echo ""

echo "--- 2/4 Redis battle keys (prefix ac:hud:battle:${INSTANCE}_*) ---"
if [[ -n "${REDIS_HOST:-}" ]]; then
  REDIS_CLI=(redis-cli -h "$REDIS_HOST")
  [[ -n "${REDIS_PORT:-}" ]] && REDIS_CLI+=(-p "$REDIS_PORT")
  [[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")
  [[ "${REDIS_SSL:-false}" == "true" ]] && REDIS_CLI+=(--tls)

  PATTERN="ac:hud:battle:${INSTANCE}_*"
  KEYS="$("${REDIS_CLI[@]}" --scan --pattern "$PATTERN" 2>/dev/null | head -n 20 || true)"
  if [[ -n "$KEYS" ]]; then
    echo "$KEYS"
    echo "OK: found battle keys for this instance"
  else
    echo "(no keys yet — start a battle in-game or check BATTLE_HUD_ENABLED)"
  fi

  LEGACY="$("${REDIS_CLI[@]}" --scan --pattern 'ac:hud:battle:*' 2>/dev/null | grep -v "ac:hud:battle:${INSTANCE}_" | head -n 5 || true)"
  if [[ -n "$LEGACY" ]]; then
    echo "WARN: other battle keys exist (other VPS or legacy serverKey without instance prefix):"
    echo "$LEGACY"
  fi
else
  echo "SKIP: REDIS_HOST not set"
fi
echo ""

echo "--- 3/4 Pub/sub channel ac:hud:updates (2s listen) ---"
if [[ -n "${REDIS_HOST:-}" ]]; then
  timeout 2 "${REDIS_CLI[@]}" SUBSCRIBE ac:hud:updates 2>/dev/null | head -n 5 || echo "(no messages in 2s — normal if no HUD activity)"
fi
echo ""

echo "--- 4/4 SSE /hud/stream ---"
HUD_BASE_URL="$BASE_URL" "$ROOT/scripts/verify-battle-hud.sh" "$STEAM_ID" || {
  echo "FAIL: SSE stream check"
  exit 1
}

echo ""
echo "--- 5/5 ac-data battle room resubscribe + push log hooks ---"
if rg -q 'refreshBattleRoomSubscription' "$ROOT/ac-data/src/services/hud/hudStreamSseBattleRoom.ts" 2>/dev/null; then
  echo "OK: battle room resubscribe helper present"
else
  echo "FAIL: missing hudStreamSseBattleRoom.ts"
  exit 1
fi
if rg -q 'HUD_BATTLE_PUSH_LOG' "$ROOT/ac-data/src/services/hud/battleHudPush.ts" 2>/dev/null; then
  echo "OK: HUD_BATTLE_PUSH_LOG hook present"
else
  echo "WARN: HUD_BATTLE_PUSH_LOG not found"
fi
echo "Live sync watch: ./scripts/verify-battle-live-sync.sh STEAM_ID"
echo ""
echo "PASS: battle pipeline checks complete"
echo "Overlay URL: ${BASE_URL%/hud}/hud/stream?steamId=${STEAM_ID}"
