#!/usr/bin/env bash
# Sanity checks for post-battle idle lobby + arming cancel snapshot fields.
#
# Usage: ./scripts/verify-battle-idle-lobby.sh STEAM_ID [dev|prod]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STEAM_ID="${1:-}"
ENV_MODE="${2:-${ASSETTO_ENV:-dev}}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 STEAM_ID [dev|prod]"
  exit 1
fi

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *) echo "Unknown mode: $ENV_MODE"; exit 1 ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

INSTANCE="${AC_INSTANCE_ID:-default}"
REDIS_CLI=(redis-cli)
[[ -n "${REDIS_HOST:-}" ]] && REDIS_CLI+=(-h "$REDIS_HOST")
[[ -n "${REDIS_PORT:-}" ]] && REDIS_CLI+=(-p "$REDIS_PORT")

echo "=== Battle idle lobby / arming cancel checks ==="
echo "steamId=$STEAM_ID instance=$INSTANCE"
echo ""

KEY="$("${REDIS_CLI[@]}" --scan --pattern "ac:hud:battle:${INSTANCE}_*:${STEAM_ID}" 2>/dev/null | head -n 1 || true)"
if [[ -z "$KEY" ]]; then
  echo "redis battle key: (none) — expected after battle clear; overlay should show LOOKING via idle lobby window"
else
  echo "redis battle key: $KEY"
  "${REDIS_CLI[@]}" GET "$KEY" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
if not raw.strip():
    print('  (empty)')
    sys.exit(0)
d = json.loads(raw)
print(f\"  state={d.get('state')} cd={d.get('armingCountdownSec')} cancel={d.get('cancelReason')}\")
hint = d.get('countdownHint')
if hint:
    print(f\"  countdownHint={hint}\")
" || true
fi

echo ""
echo "Client config (ProjectD-HUD):"
echo "  BATTLE_IDLE_LOBBY_SEC — post-fight LOOKING overlay window"
echo "  BATTLE_SYNTHETIC_LOBBY_SEC — legacy; profile lobby gate supersedes connect window"
echo ""
echo "Profile battle lobby gates (Lua source):"
grep -q 'should_show_profile_battle_lobby' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK should_show_profile_battle_lobby defined" \
  || { echo "  FAIL missing should_show_profile_battle_lobby"; exit 1; }
grep -q 'cached_bundle == nil' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK requires cached_bundle (no lobby without hud_session)" \
  || { echo "  FAIL cached_bundle gate missing"; exit 1; }
grep -q 'player_not_connected' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK blocks player_not_connected registration" \
  || { echo "  FAIL player_not_connected gate missing"; exit 1; }
grep -q 'should_show_profile_battle_lobby' ProjectD-HUD/common/api_data.lua \
  && echo "  OK api.get_battle uses profile lobby gate" \
  || { echo "  FAIL api_data profile lobby path missing"; exit 1; }
if grep -q 'Looking for opponent' ProjectD-HUD/battle/first.lua; then
  echo "  FAIL first.lua still has plain Looking for opponent fallback"
  exit 1
else
  echo "  OK no plain Looking for opponent in first.lua"
fi
grep -q 'snapshot_poll_at = 0' ProjectD-HUD/common/api/battle_transport.lua \
  && echo "  OK server change forces immediate snapshot poll" \
  || { echo "  FAIL snapshot_poll_at reset on context change"; exit 1; }
grep -q 'should_show_connecting_battle_lobby' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK should_show_connecting_battle_lobby defined" \
  || { echo "  FAIL missing should_show_connecting_battle_lobby"; exit 1; }
grep -q 'lobby_connecting_from_profile' ProjectD-HUD/common/api/battle/battle_players.lua \
  && echo "  OK lobby_connecting_from_profile in battle_players" \
  || { echo "  FAIL lobby_connecting_from_profile missing"; exit 1; }
grep -q 'lobby_connecting_from_profile' ProjectD-HUD/common/api/battle_parse.lua \
  && echo "  OK lobby_connecting_from_profile wrapper in battle_parse" \
  || { echo "  FAIL battle_parse connecting lobby wrapper missing"; exit 1; }
grep -q 'should_show_connecting_battle_lobby' ProjectD-HUD/common/api_data.lua \
  && echo "  OK api.get_battle uses connecting lobby gate" \
  || { echo "  FAIL api_data connecting lobby path missing"; exit 1; }
if grep -q 'if msg == nil then return' ProjectD-HUD/battle/first.lua; then
  echo "  FAIL first.lua still returns without drawing on nil message"
  exit 1
else
  echo "  OK first.lua always draws fallback when battle nil"
fi
echo ""
echo "Server env:"
grep -E '^BATTLE_ARM_(MIN|CANCEL)_SPEED' "$ENV_FILE" 2>/dev/null || echo "  (using defaults: continue=40 cancel=55 km/h)"
echo ""
echo "In-game: ac.storage('ProjectD-HUD:battle_debug', true):set() — expect CONNECTING lobby (profile + center) then LOOKING; no blank HUD on server enter."
