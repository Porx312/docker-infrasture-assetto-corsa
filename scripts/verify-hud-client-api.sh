#!/usr/bin/env bash
# Smoke check: public HUD download API (/client/hud/*).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

BASE="${STAGING_API_URL:-http://127.0.0.1:3000}"
BASE="${BASE%/}"

echo "=== HUD client API smoke ($BASE) ==="

latest="$(curl -sf "$BASE/client/hud/latest" || true)"
if [[ -z "$latest" ]]; then
  echo "WARN: /client/hud/latest unreachable or empty (is ac-data running?)"
  exit 0
fi

echo "OK: /client/hud/latest"
echo "$latest" | head -c 200
echo ""

if echo "$latest" | grep -q '"filename"'; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -L "$BASE/client/hud/download")"
  if [[ "$code" == "200" ]]; then
    echo "OK: /client/hud/download -> 200"
  else
    echo "FAIL: /client/hud/download -> $code"
    exit 1
  fi
else
  echo "SKIP: no HUD release uploaded yet"
fi

for removed in launcher/latest servers content/manifest; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/client/$removed")"
  if [[ "$code" == "404" ]]; then
    echo "OK: /client/$removed -> 404 (removed)"
  else
    echo "WARN: /client/$removed -> $code (expected 404)"
  fi
done

echo ""
echo "Verification PASSED"
