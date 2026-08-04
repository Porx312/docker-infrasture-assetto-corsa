#!/usr/bin/env bash
# End-to-end HUD stack verification: local contract checks + optional live API probes.
#
# Usage: ./scripts/verify-hud-e2e.sh [steamId] [api_key]
#
# Environment:
#   HUD_E2E_SKIP_LIVE=1   Skip curl/Redis live checks (CI default)
#   ASSETTO_ENV_FILE      Env file for API base URL (default .env.local)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEAM_ID="${1:-76561199230780195}"
API_KEY="${2:-}"
SKIP_LIVE="${HUD_E2E_SKIP_LIVE:-0}"

fail=0

run_step() {
  local label="$1"
  shift
  echo ""
  echo "=== ${label} ==="
  if "$@"; then
    echo "OK: ${label}"
  else
    echo "FAIL: ${label}"
    fail=1
  fi
}

echo "ProjectD HUD e2e verification (steamId=${STEAM_ID}, skip_live=${SKIP_LIVE})"

run_step "ProjectD-HUD require paths" "${ROOT}/ProjectD-HUD/scripts/verify-requires.sh"
run_step "ProjectD-HUD center labels (structural)" "${ROOT}/ProjectD-HUD/scripts/verify-center-labels.sh"
run_step "ProjectD-HUD gap direction (structural)" "${ROOT}/ProjectD-HUD/scripts/verify-gap-direction.sh"
run_step "ProjectD-HUD battle rematch (structural)" "${ROOT}/ProjectD-HUD/scripts/verify-battle-rematch.sh"

if [[ -d "${ROOT}/ac-data/node_modules" ]] || [[ -f "${ROOT}/ac-data/package.json" ]]; then
  run_step "ac-data HUD unit tests" bash -c "cd '${ROOT}/ac-data' && npx tsx --test src/services/hud/hudSnapshot.test.ts src/services/hud/hudStreamSse.test.ts"
else
  echo ""
  echo "SKIP: ac-data npm test (run npm ci in ac-data first)"
fi

if [[ "${SKIP_LIVE}" == "1" ]]; then
  echo ""
  echo "SKIP live checks (HUD_E2E_SKIP_LIVE=1)"
else
  if [[ -f "${ROOT}/ac-data/dist/services/hud/hudConvex.js" ]]; then
    run_step "Convex hud_session" "${ROOT}/scripts/verify-convex-hud-session.sh" "${STEAM_ID}" || true
  else
    echo ""
    echo "SKIP: verify-convex-hud-session (ac-data not built)"
  fi

  run_step "HUD SSE overlay contract" "${ROOT}/scripts/verify-hud-overlay-contract.sh" "${STEAM_ID}" ${API_KEY:+"${API_KEY}"} || true
  run_step "Battle HUD SSE" "${ROOT}/scripts/verify-battle-hud.sh" "${STEAM_ID}" || true

  if command -v redis-cli >/dev/null 2>&1; then
    run_step "HUD lap pipeline (Redis)" "${ROOT}/scripts/verify-hud-lap-pipeline.sh" "${STEAM_ID}" || true
  else
    echo ""
    echo "SKIP: verify-hud-lap-pipeline (redis-cli not found)"
  fi
fi

echo ""
if [[ "${fail}" -ne 0 ]]; then
  echo "HUD e2e verification FAILED"
  exit 1
fi

echo "HUD e2e verification PASSED"
