#!/usr/bin/env bash
# Compare HUD snapshot identity fields for VPS differential debugging (Gunsai vs Battle).
# Run while connected to each server (same steamId). Diff two runs to find first divergence.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a
# shellcheck source=lib/hud-steam-defaults.sh
source "$ROOT/scripts/lib/hud-steam-defaults.sh"

STEAM_ID="${1:-$HUD_DEFAULT_STEAM_ID}"
LABEL="${2:-}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 [STEAM_ID] [label]"
  echo "  label: optional tag (e.g. gunsai, battle) for comparison table"
  echo "  default steamId: HUD_DEFAULT_STEAM_ID ($HUD_DEFAULT_STEAM_ID)"
  exit 1
fi

REDIS_CLI=(redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6379}")
[[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")

PRESENCE_KEY="ac:hud:presence:${STEAM_ID}"
SESSION_KEY="ac:hud:session:${STEAM_ID}"
SSE_KEY="ac:hud:sse:${STEAM_ID}"

API="${STAGING_API_URL:-http://127.0.0.1:3000}"
SNAP_URL="${API%/}/hud/snapshot?steamId=${STEAM_ID}"
[[ -n "${HUD_API_KEY:-}" ]] && SNAP_URL="${SNAP_URL}&api_key=${HUD_API_KEY}"

echo "=== HUD server identity compare (steamId=$STEAM_ID${LABEL:+, label=$LABEL}) ==="
echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

echo "--- Redis presence ($PRESENCE_KEY) ---"
PRESENCE_RAW="$("${REDIS_CLI[@]}" GET "$PRESENCE_KEY" 2>/dev/null || true)"
if [[ -z "$PRESENCE_RAW" ]]; then
  echo "presence: (missing)"
else
  python3 -c "
import json, sys
d = json.loads(sys.argv[1])
print('presence.serverName:', (d.get('serverName') or '?')[:120])
print('presence.track:', (d.get('track') or d.get('trackId') or '?')[:80])
print('presence.carModel:', (d.get('carModel') or '?')[:40])
" "$PRESENCE_RAW"
fi

echo ""
echo "--- Redis session cache ($SESSION_KEY) ---"
SESSION_RAW="$("${REDIS_CLI[@]}" GET "$SESSION_KEY" 2>/dev/null || true)"
if [[ -z "$SESSION_RAW" ]]; then
  echo "session_cache: (missing)"
else
  python3 -c "
import json, sys
raw = sys.argv[1]
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    print('session_cache: (not json)', raw[:120])
    sys.exit(0)
ctx = d.get('context') or {}
print('session_cache.context.server_name:', (ctx.get('server_name') or '?')[:120])
print('session_cache.context.track_id:', (ctx.get('track_id') or '?')[:80])
print('session_cache.version:', (d.get('version') or '?')[:80])
" "$SESSION_RAW"
fi

echo ""
echo "--- Redis SSE presence ($SSE_KEY) ---"
SSE_RAW="$("${REDIS_CLI[@]}" GET "$SSE_KEY" 2>/dev/null || true)"
if [[ -z "$SSE_RAW" ]]; then
  echo "sse_presence: (missing)"
else
  python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    print('sse.connected:', d.get('connected'), 'at:', d.get('connectedAt'))
except Exception:
    print('sse_presence:', sys.argv[1][:120])
" "$SSE_RAW"
fi

echo ""
echo "--- GET /hud/snapshot ---"
HTTP_BODY="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$HTTP_BODY" -w '%{http_code}' "$SNAP_URL" || echo "000")"
echo "http_code: $HTTP_CODE"
python3 -c "
import json, sys
raw = open(sys.argv[1], encoding='utf-8', errors='replace').read().strip()
label = sys.argv[2]
if label:
    print('label:', label)
if not raw:
    print('body: (empty)')
    sys.exit(0)
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    print('body (not JSON):', raw[:300])
    sys.exit(0)
print('ok:', d.get('ok'))
print('reason:', d.get('reason'))
session = d.get('session') or {}
if isinstance(session, dict):
    ctx = session.get('context') or {}
    if isinstance(ctx, dict):
        print('context.server_name:', (ctx.get('server_name') or '?')[:120])
        print('context.track_id:', (ctx.get('track_id') or '?')[:80])
        print('context.layout_id:', (ctx.get('layout_id') or '?')[:40])
    print('session.ok:', session.get('ok'))
    print('session.reason:', session.get('reason'))
    print('session.version:', (session.get('version') or '?')[:80])
battle = d.get('battle') or {}
if isinstance(battle, dict):
    print('battle.ok:', battle.get('ok'))
    print('battle.state:', battle.get('state', battle.get('reason')))
" "$HTTP_BODY" "$LABEL"
rm -f "$HTTP_BODY"

echo ""
echo "--- Managed server NAME= (local instances) ---"
if compgen -G "$ROOT/server*/cfg/server_cfg.ini" >/dev/null 2>&1; then
  grep -h '^NAME=' "$ROOT"/server*/cfg/server_cfg.ini 2>/dev/null | sort -u || true
else
  echo "(no server*/cfg/server_cfg.ini under $ROOT)"
fi

echo ""
echo "Tip: run once on Gunsai, once on Battle, then diff:"
echo "  $0 $STEAM_ID gunsai | tee /tmp/hud-gunsai.txt"
echo "  $0 $STEAM_ID battle | tee /tmp/hud-battle.txt"
echo "  diff -u /tmp/hud-gunsai.txt /tmp/hud-battle.txt"
