#!/usr/bin/env bash
# Verify SSE contract: hud_version / hud_session / battle events.
# Usage: ./scripts/verify-hud-overlay-contract.sh [steamId] [api_key]
set -euo pipefail

STEAM_ID="${1:-76561199230780195}"
API_KEY="${2:-}"
HOST="${HUD_HOST:-127.0.0.1:3000}"
URL="http://${HOST}/hud/stream?steamId=${STEAM_ID}"
if [[ -n "${API_KEY}" ]]; then
  URL="${URL}&api_key=${API_KEY}"
fi

echo "=== HUD SSE contract check ==="
echo "SSE URL: ${URL}"
echo "Expect events: hud_version, hud_session (profile.rivals), battle"
echo "(timeout 15s — connect in-game first)"
echo

timeout 15 curl -sN "${URL}" 2>/dev/null | while IFS= read -r line; do
  if [[ "${line}" == event:* ]]; then
    EVENT="${line#event: }"
    echo "event: ${EVENT}"
  elif [[ "${line}" == data:* ]]; then
    payload="${line#data: }"
    if echo "${payload}" | rg -q '"rivals"'; then
      echo "OK rivals present in hud_session"
    fi
    if echo "${payload}" | rg -q '"best_lap_ms"'; then
      echo "OK best_lap_ms present"
    fi
    if echo "${payload}" | rg -q '"lbVersion"'; then
      echo "OK hud_version lbVersion present"
    fi
    echo "${payload}" | head -c 800
    echo
    if echo "${payload}" | rg -q '"rivals"'; then
      break
    fi
  fi
done || echo "No SSE data within 15s (is ac-data running and player connected?)"
