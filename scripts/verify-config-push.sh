#!/usr/bin/env bash
# Verify POST /hud/worker/refresh-config (config push webhook).
set -euo pipefail

ROOT="$(cd "$(dirname "$(dirname "$0")")" && pwd)"
cd "$ROOT"

ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PORT="${PORT:-3000}"
HOST="${AC_DATA_HOST:-127.0.0.1}"
INSTANCE_ID="${AC_INSTANCE_ID:-default}"
SECRET="${CONVEX_WORKER_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "FAIL: CONVEX_WORKER_SECRET not set (source $ENV_FILE)"
  exit 1
fi

echo "=== Config push webhook ==="
echo "POST http://${HOST}:${PORT}/hud/worker/refresh-config instanceId=${INSTANCE_ID}"

RESPONSE="$(curl -sS -w "\n%{http_code}" -X POST "http://${HOST}:${PORT}/hud/worker/refresh-config" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: ${SECRET}" \
  -d "{\"instanceId\":\"${INSTANCE_ID}\",\"reason\":\"verify_script\"}")"

BODY="$(echo "$RESPONSE" | head -n -1)"
CODE="$(echo "$RESPONSE" | tail -n 1)"

echo "HTTP ${CODE}"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [[ "$CODE" != "200" ]]; then
  echo ""
  echo "Verification FAILED"
  exit 1
fi

if ! echo "$BODY" | rg -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "FAIL: response ok != true"
  exit 1
fi

echo ""
echo "Verification PASSED"
echo "Tip: tail -f ac-data.log | rg 'refresh-config|redis-config-sync.*reason='"
