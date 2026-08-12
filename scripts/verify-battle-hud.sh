#!/usr/bin/env bash
# Verify unified HUD SSE stream (requires ac-data running + HUD_API_KEY).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env.local" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
fi
# shellcheck source=lib/hud-steam-defaults.sh
source "$ROOT/scripts/lib/hud-steam-defaults.sh"

STEAM_ID="${1:-$HUD_DEFAULT_STEAM_ID}"
API_KEY="${2:-${HUD_API_KEY:-}}"
BASE_URL="${HUD_BASE_URL:-http://127.0.0.1:3000/hud}"
TIMEOUT_SEC="${HUD_VERIFY_TIMEOUT_SEC:-5}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 [steamId] [api_key]"
  echo "  default steamId: $HUD_DEFAULT_STEAM_ID"
  exit 1
fi

ENC_STEAM="$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$STEAM_ID'''))")"

STREAM_URL="${BASE_URL}/stream?steamId=${ENC_STEAM}&carFilter=global"
if [[ -n "$API_KEY" ]]; then
  ENC_KEY="$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$API_KEY'''))")"
  STREAM_URL="${STREAM_URL}&api_key=${ENC_KEY}"
else
  echo "WARN: no HUD_API_KEY — expect HTTP 401" >&2
fi

echo "=== GET /hud/stream (SSE, ${TIMEOUT_SEC}s) ==="
echo "URL: ${STREAM_URL/api_key=*/api_key=***}"

curl -sfN --max-time "$TIMEOUT_SEC" "$STREAM_URL" | head -n 20

echo ""
echo "OK: SSE stream reachable (hud_session on connect; battle events when active)"
