#!/usr/bin/env bash
# Debug HUD presence + snapshot for a steamId (no secrets printed).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STEAM_ID="${1:-}"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 STEAM_ID"
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

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
curl -sS "$SNAP_URL" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('ok:', d.get('ok'), 'reason:', d.get('reason'))
b = d.get('battle') or {}
if isinstance(b, dict):
    print('battle:', b.get('ok'), b.get('state', b.get('reason')))
"
