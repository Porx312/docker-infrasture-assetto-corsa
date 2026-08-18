#!/usr/bin/env bash
# Verify WSS contract: hud_version / hud_session / battle events on GET /hud/ws.
# Usage: ./scripts/verify-hud-ws-contract.sh [steamId] [api_key]
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
API_KEY="${2:-${HUD_API_KEY:-}}"
TIMEOUT_SEC="${HUD_WS_VERIFY_SEC:-20}"

if [[ -z "${API_KEY}" ]]; then
  echo "HUD_API_KEY missing (set in $ENV_FILE or pass as 2nd arg)" >&2
  exit 1
fi

API_BASE="${HUD_API_BASE:-${STAGING_API_URL:-}}"
if [[ -n "${API_BASE}" ]]; then
  BASE="${API_BASE%/}"
elif [[ -n "${HUD_HOST:-}" ]]; then
  if [[ "${HUD_HOST}" == *"://"* ]]; then
    BASE="${HUD_HOST%/}"
  elif [[ "${HUD_HOST}" == *"projectd.space"* ]]; then
    BASE="https://${HUD_HOST}"
  else
    BASE="http://${HUD_HOST}"
  fi
else
  BASE="http://127.0.0.1:3000"
fi

WS_BASE="${BASE/https:\/\//wss://}"
WS_BASE="${WS_BASE/http:\/\//ws://}"
WS_URL="${WS_BASE}/hud/ws?steamId=${STEAM_ID}&api_key=${API_KEY}"

echo "=== HUD WSS contract check ==="
echo "WSS URL: ${WS_URL%%api_key=*}api_key=***"
echo "Expect JSON frames: hud_version, hud_session (profile.rivals), battle"
echo "(timeout ${TIMEOUT_SEC}s — connect in-game first)"
echo

export WS_URL TIMEOUT_SEC
(cd "$ROOT/ac-data" && node - <<'NODE'
const WebSocket = require('ws');

const url = process.env.WS_URL;
const timeoutSec = Number(process.env.TIMEOUT_SEC || 20);

const events = [];
let hasRivals = false;
let hasVersion = false;

const ws = new WebSocket(url);

const timer = setTimeout(() => {
  console.error('FAIL: timeout waiting for hud_session with rivals');
  ws.close();
  process.exit(1);
}, timeoutSec * 1000);

ws.on('open', () => {
  console.log('[verify] connected');
});

ws.on('message', (data) => {
  let frame;
  try {
    frame = JSON.parse(data.toString('utf8'));
  } catch {
    console.log('[verify] non-json frame skipped');
    return;
  }
  const event = frame.event;
  events.push(event);
  console.log(`event: ${event}`);
  if (event === 'hud_version') {
    hasVersion = true;
    if (frame.data?.lbVersion) console.log('OK hud_version lbVersion present');
  }
  if (event === 'hud_session') {
    const payload = JSON.stringify(frame.data ?? {});
    if (payload.includes('"rivals"')) {
      hasRivals = true;
      console.log('OK rivals present in hud_session');
    }
    if (payload.includes('"best_lap_ms"')) {
      console.log('OK best_lap_ms present');
    }
  }
  if (hasRivals && hasVersion) {
    clearTimeout(timer);
    console.log('');
    console.log('OK: hud_session received (profile.rivals present)');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error('FAIL:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  if (!hasRivals) {
    clearTimeout(timer);
    console.error(`FAIL: closed early code=${code} reason=${reason.toString('utf8')} events=${events.join(',')}`);
    process.exit(1);
  }
});
NODE
)
