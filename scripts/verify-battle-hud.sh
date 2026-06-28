#!/usr/bin/env bash
# Verify unified HUD SSE stream (requires ac-data running).
set -euo pipefail

STEAM_ID="${1:-}"
BASE_URL="${HUD_BASE_URL:-http://localhost:3000/hud}"
TIMEOUT_SEC="${HUD_VERIFY_TIMEOUT_SEC:-5}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 steamId"
  echo "Example: $0 76561199000000001"
  exit 1
fi

ENC_STEAM="$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$STEAM_ID'''))")"

STREAM_URL="${BASE_URL}/stream?steamId=${ENC_STEAM}"
echo "=== GET /hud/stream (SSE, ${TIMEOUT_SEC}s) ==="
echo "URL: $STREAM_URL"

curl -sfN --max-time "$TIMEOUT_SEC" "$STREAM_URL" | head -n 20

echo ""
echo "OK: SSE stream reachable (session:update on connect; battle events when active)"
