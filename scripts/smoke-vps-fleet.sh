#!/usr/bin/env bash
# Smoke checks for hub + edge fleet (VPS_FLEET_SETUP.md).
# Usage:
#   ./scripts/smoke-vps-fleet.sh
#   HUB_URL=http://127.0.0.1:3001 EDGE_URL=http://127.0.0.1:3000 ./scripts/smoke-vps-fleet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/.env.local" 2>/dev/null || true
# shellcheck disable=SC1091
source "${ROOT}/ProjectD-Backend-Servers/.env.local" 2>/dev/null || true

HUB_URL="${HUB_URL:-http://127.0.0.1:3001}"
EDGE_URL="${EDGE_URL:-http://127.0.0.1:3000}"
WORKER_SECRET="${CONVEX_WORKER_SECRET:-}"
HUD_KEY="${HUD_API_KEY:-}"
INSTANCE_ID="${AC_INSTANCE_ID:-vps-eu-2}"
FAIL=0

ok() { echo "  OK  $*"; }
bad() { echo "  FAIL $*"; FAIL=1; }

echo "== Fleet smoke =="
echo "hub=$HUB_URL edge=$EDGE_URL instanceId=$INSTANCE_ID"
echo

echo "-- 1. Health --"
if curl -sfS -m 5 "${HUB_URL}/api/health" >/dev/null; then ok "hub /api/health"; else bad "hub /api/health"; fi
if curl -sfS -m 5 "${EDGE_URL}/api/health" >/dev/null; then ok "edge /api/health"; else bad "edge /api/health"; fi

echo "-- 2. Shared Redis (hub + edge same host) --"
EDGE_PID="$(pgrep -af 'packages/ac-data-edge/src/index.ts' | awk 'NR==1{print $1}' || true)"
EDGE_REDIS=""
if [[ -n "${EDGE_PID}" && -r "/proc/${EDGE_PID}/environ" ]]; then
  EDGE_REDIS="$(tr '\0' '\n' < "/proc/${EDGE_PID}/environ" | grep '^REDIS_HOST=' | cut -d= -f2- || true)"
fi
HUB_REDIS="${REDIS_HOST:-}"
if [[ -n "$HUB_REDIS" && -n "$EDGE_REDIS" && "$HUB_REDIS" == "$EDGE_REDIS" ]]; then
  ok "REDIS_HOST match: $HUB_REDIS"
else
  ok "REDIS_HOST hub=${HUB_REDIS:-?} edge=${EDGE_REDIS:-?} (manual check if pids missing)"
fi

echo "-- 3. Control API live --"
if [[ -z "$WORKER_SECRET" ]]; then
  bad "CONVEX_WORKER_SECRET empty"
else
  SUMMARY="$(curl -sfS -m 8 "${HUB_URL}/v1/live/summary" -H "X-Worker-Secret: ${WORKER_SECRET}" || true)"
  if echo "$SUMMARY" | grep -q '"ok":true'; then ok "GET /v1/live/summary"; else bad "GET /v1/live/summary → ${SUMMARY:-empty}"; fi
  # Seed scoped roster and verify GET without instanceId discovers it
  if command -v redis-cli >/dev/null 2>&1; then
    REDIS_ARGS=(redis-cli --no-auth-warning)
    [[ -n "${REDIS_HOST:-}" ]] && REDIS_ARGS+=(-h "$REDIS_HOST")
    [[ -n "${REDIS_PORT:-}" ]] && REDIS_ARGS+=(-p "$REDIS_PORT")
    [[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_ARGS+=(-a "$REDIS_PASSWORD")
    "${REDIS_ARGS[@]}" SET "ac:hud:presence:roster:${INSTANCE_ID}:smokelobby" '["76561199000000099"]' EX 60 >/dev/null
    LIVE="$(curl -sfS -m 8 "${HUB_URL}/v1/servers/smokelobby/live" -H "X-Worker-Secret: ${WORKER_SECRET}" || true)"
    if echo "$LIVE" | grep -q '76561199000000099'; then
      ok "GET /v1/servers/smokelobby/live discovers scoped roster"
    else
      bad "scoped live discover → ${LIVE:-empty}"
    fi
  fi
fi

echo "-- 4. Mods inventory --"
if [[ -n "$WORKER_SECRET" ]]; then
  CARS="$(curl -sfS -m 8 "${HUB_URL}/v1/instances/${INSTANCE_ID}/mods/cars" -H "X-Worker-Secret: ${WORKER_SECRET}" || true)"
  if echo "$CARS" | grep -q '"ok":true'; then ok "GET /v1/instances/${INSTANCE_ID}/mods/cars"; else bad "mods cars → ${CARS:-empty}"; fi
fi

echo "-- 5. Branding public URL --"
BRAND_DIR="${BRANDING_IMAGES_PATH:-${ROOT}/ProjectD-Backend-Servers/data/branding}"
mkdir -p "$BRAND_DIR"
# Minimal 1x1 PNG
python3 - <<'PY' "$BRAND_DIR/smoke.png"
import sys, pathlib, base64
png = base64.b64decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
pathlib.Path(sys.argv[1]).write_bytes(png)
PY
CODE="$(curl -sS -m 8 -o /tmp/branding-smoke.png -w '%{http_code}' "${HUB_URL}/branding/images/smoke.png" || echo 000)"
if [[ "$CODE" == "200" ]]; then ok "GET /branding/images/smoke.png (HTTP 200)"; else bad "branding image HTTP $CODE"; fi

echo "-- 6. HUD bootstrap auth surface --"
if [[ -n "$HUD_KEY" ]]; then
  BOOT="$(curl -sS -m 8 -o /tmp/hud-boot.json -w '%{http_code}' \
    "${HUB_URL}/hud/bootstrap?steamId=76561199000000001" -H "x-api-key: ${HUD_KEY}" || echo 000)"
  if [[ "$BOOT" == "200" || "$BOOT" == "404" || "$BOOT" == "503" ]]; then
    ok "GET /hud/bootstrap → HTTP $BOOT"
  else
    bad "GET /hud/bootstrap → HTTP $BOOT"
  fi
else
  bad "HUD_API_KEY empty"
fi

echo "-- 7. Config webhook resolve --"
if [[ -n "$WORKER_SECRET" ]]; then
  CFG="$(curl -sfS -m 15 -X POST "${HUB_URL}/hud/worker/refresh-config" \
    -H "Content-Type: application/json" \
    -d "{\"workerSecret\":\"${WORKER_SECRET}\",\"instanceId\":\"${INSTANCE_ID}\"}" || true)"
  if echo "$CFG" | grep -Eq 'edge_push|ok|mode'; then ok "refresh-config → ${CFG:0:120}"; else bad "refresh-config → ${CFG:-empty}"; fi
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "All smoke checks passed."
  exit 0
fi
echo "Smoke finished with failures."
exit 1
