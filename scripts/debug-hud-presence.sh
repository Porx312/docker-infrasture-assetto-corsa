#!/usr/bin/env bash
# Debug HUD presence + snapshot for a steamId (no secrets printed).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a
# shellcheck source=lib/hud-steam-defaults.sh
source "$ROOT/scripts/lib/hud-steam-defaults.sh"

STEAM_ID="${1:-$HUD_DEFAULT_STEAM_ID}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 [STEAM_ID]"
  echo "  default: HUD_DEFAULT_STEAM_ID ($HUD_DEFAULT_STEAM_ID)"
  exit 1
fi

REDIS_CLI=(redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6379}")
[[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")

PRESENCE_KEY="ac:hud:presence:${STEAM_ID}"
echo "=== HUD presence debug (steamId=$STEAM_ID) ==="
echo "Redis key: $PRESENCE_KEY"
EXISTS="$("${REDIS_CLI[@]}" EXISTS "$PRESENCE_KEY" 2>/dev/null || echo 0)"
echo "Redis EXISTS: $EXISTS"
if [[ "$EXISTS" == "1" ]]; then
  "${REDIS_CLI[@]}" GET "$PRESENCE_KEY" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
    print('serverName:', d.get('serverName', '?')[:80])
except Exception as e:
    print('parse error:', e)
"
fi

API="${STAGING_API_URL:-http://127.0.0.1:3000}"
SNAP_URL="${API%/}/hud/snapshot?steamId=${STEAM_ID}"
[[ -n "${HUD_API_KEY:-}" ]] && SNAP_URL="${SNAP_URL}&api_key=${HUD_API_KEY}"

echo ""
echo "GET snapshot (reason only):"
HTTP_BODY="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$HTTP_BODY" -w '%{http_code}' "$SNAP_URL" || echo "000")"
echo "HTTP: $HTTP_CODE"
python3 -c "
import json, sys
raw = open(sys.argv[1], encoding='utf-8', errors='replace').read().strip()
if not raw:
    print('body: (empty)')
    sys.exit(0)
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    print('body (not JSON):', raw[:200])
    sys.exit(0)
print('ok:', d.get('ok'), 'reason:', d.get('reason'))
b = d.get('battle') or {}
if isinstance(b, dict):
    print('battle:', b.get('ok'), b.get('state', b.get('reason')))
    if b.get('ok'):
        p1 = b.get('player1') or {}
        p2 = b.get('player2') or {}
        if isinstance(p1, dict):
            print('  p1:', p1.get('name'), 'score=', p1.get('score'))
        if isinstance(p2, dict):
            print('  p2:', p2.get('name'), 'score=', p2.get('score'))
        print('  battleId:', (b.get('battleId') or '')[:24])
" "$HTTP_BODY"
rm -f "$HTTP_BODY"
