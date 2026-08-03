#!/usr/bin/env bash
# Verify SSE contract: hud_version / hud_session / battle events.
# Usage: ./scripts/verify-hud-overlay-contract.sh [steamId] [api_key]
#
# Host selection (first match wins):
#   HUD_API_BASE / STAGING_API_URL  — full base URL (e.g. https://dev-api.projectd.space)
#   HUD_HOST=dev-api.projectd.space — uses https when host contains projectd.space
#   default                         — http://127.0.0.1:3000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-${ROOT}/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

STEAM_ID="${1:-76561199230780195}"
API_KEY="${2:-}"

API_BASE="${HUD_API_BASE:-${STAGING_API_URL:-}}"
if [[ -n "${API_BASE}" ]]; then
  URL="${API_BASE%/}/hud/stream?steamId=${STEAM_ID}"
elif [[ -n "${HUD_HOST:-}" ]]; then
  if [[ "${HUD_HOST}" == *"://"* ]]; then
    URL="${HUD_HOST%/}/hud/stream?steamId=${STEAM_ID}"
  elif [[ "${HUD_HOST}" == *"projectd.space"* ]]; then
    URL="https://${HUD_HOST}/hud/stream?steamId=${STEAM_ID}"
  else
    URL="http://${HUD_HOST}/hud/stream?steamId=${STEAM_ID}"
  fi
else
  URL="http://127.0.0.1:3000/hud/stream?steamId=${STEAM_ID}"
fi

if [[ -n "${API_KEY}" ]]; then
  URL="${URL}&api_key=${API_KEY}"
fi

echo "=== HUD SSE contract check ==="
echo "SSE URL: ${URL}"
echo "Expect events: hud_version, hud_session (profile.rivals), battle"
echo "(timeout 15s — connect in-game first)"
echo

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

set +e
timeout 15 curl -sN "${URL}" 2>/dev/null | tee "$TMP" | while IFS= read -r line; do
  if [[ "${line}" == event:* ]]; then
    EVENT="${line#event: }"
    echo "event: ${EVENT}"
  elif [[ "${line}" == data:* ]]; then
    payload="${line#data: }"
    if echo "${payload}" | grep -q '"rivals"'; then
      echo "OK rivals present in hud_session"
    fi
    if echo "${payload}" | grep -q '"best_lap_ms"'; then
      echo "OK best_lap_ms present"
    fi
    if echo "${payload}" | grep -q '"lbVersion"'; then
      echo "OK hud_version lbVersion present"
    fi
    echo "${payload}" | head -c 800
    echo
    if echo "${payload}" | grep -q '"rivals"'; then
      break
    fi
  fi
done
CURL_STATUS=$?
set -e

if grep -q '"rivals"' "$TMP" 2>/dev/null; then
  echo
  echo "OK: hud_session received (profile.rivals present)"
  exit 0
fi

if [[ ! -s "$TMP" ]]; then
  echo "No SSE data within 15s (is ac-data running and player connected?)"
  exit 1
fi

if [[ "$CURL_STATUS" -ne 0 ]]; then
  echo "SSE stream ended without hud_session (curl exit ${CURL_STATUS})"
  exit 1
fi

echo "SSE connected but no hud_session with rivals within 15s"
exit 1
