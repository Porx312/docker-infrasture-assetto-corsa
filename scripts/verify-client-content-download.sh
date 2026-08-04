#!/usr/bin/env bash
# Verify launcher content download endpoints (Content-Length, HEAD, zip_building).
#
# Usage:
#   ./scripts/verify-client-content-download.sh [base_url] [track_name] [car_name]
#
# Examples:
#   ./scripts/verify-client-content-download.sh
#   ./scripts/verify-client-content-download.sh https://dev-api.projectd.space pk_akina j8_toyota_ae86_shinji
#
# Environment:
#   ASSETTO_ENV_FILE   Env file for default BASE (default .env.local)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-${ROOT}/.env.local}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

BASE="${1:-http://localhost:3000}"
TRACK="${2:-pk_akina}"
CAR="${3:-j8_toyota_ae86_shinji}"

fail=0

check_head() {
  local type="$1"
  local name="$2"
  local label="${type}/${name}"

  echo ""
  echo "=== HEAD ${label} ==="

  local headers
  headers="$(curl -sS -D - -o /dev/null -m 120 -I "${BASE}/client/content/${type}/${name}/download" || true)"
  local status
  status="$(printf '%s' "${headers}" | awk 'toupper($1) ~ /^HTTP/ { code=$2 } END { print code+0 }')"
  local length
  length="$(printf '%s' "${headers}" | awk -F': ' 'tolower($1)=="content-length" { print $2 }' | tr -d '\r')"

  echo "HTTP ${status}"

  if [[ "${status}" == "200" ]]; then
    if [[ -n "${length}" && "${length}" -gt 0 ]]; then
      echo "OK: Content-Length=${length}"
      return 0
    fi
    echo "FAIL: 200 but missing Content-Length"
    fail=1
    return 1
  fi

  if [[ "${status}" == "503" ]]; then
    echo "WARN: zip still building (503 zip_building) — run ./scripts/warm-content-zip-cache.sh ${type}:${name}"
    fail=1
    return 1
  fi

  echo "FAIL: unexpected status ${status}"
  printf '%s\n' "${headers}" | head -20
  fail=1
  return 1
}

echo "Client content download verification"
echo "  BASE=${BASE}"
echo "  TRACK=${TRACK}"
echo "  CAR=${CAR}"

check_head tracks "${TRACK}" || true
check_head cars "${CAR}" || true

echo ""
if [[ "${fail}" -eq 0 ]]; then
  echo "All checks passed."
  exit 0
fi

echo "Some checks failed."
exit 1
