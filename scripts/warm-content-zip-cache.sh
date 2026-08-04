#!/usr/bin/env bash
# Warm content ZIP cache for launcher mod downloads (large tracks like pk_akina).
#
# Usage:
#   ./scripts/warm-content-zip-cache.sh
#   ./scripts/warm-content-zip-cache.sh tracks:pk_akina
#
# Environment (from ASSETTO_ENV_FILE or .env.local):
#   CLIENT_SYNC_WARM_MODS=tracks:pk_akina,cars:my_mod
#   CLIENT_SYNC_ZIP_CACHE_PATH=/var/cache/assetto/content-zips
#
# Run after deploy or when track downloads return 502/503 on dev-api.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-${ROOT}/.env.local}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

export ASSETTO_ENV_FILE="${ENV_FILE}"

echo "Warming content ZIP cache (env: ${ENV_FILE})"
cd "${ROOT}/ac-data"
exec npx tsx scripts/warm-content-zip-cache.mjs "$@"
