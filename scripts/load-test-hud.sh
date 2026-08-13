#!/usr/bin/env bash
# Realistic Battle HUD load test — simulates overlay snapshot polling (not blind flood).
#
# Usage:
#   ./scripts/load-test-hud.sh --clients 10 --duration 60 --ramp 10
#   ./scripts/load-test-hud.sh --profile progressive --confirm
#   ./scripts/load-test-hud.sh --clients 100 --scenario lifecycle --duration 600 --confirm
#
# Options:
#   --clients N           Simulated HUD clients (default: 10)
#   --duration SEC        Hold duration per level (default: 600)
#   --ramp SEC            Ramp-up window (default: 30)
#   --server NAME         Primary server display name
#   --server-b NAME       Secondary server for server-change scenario
#   --battle SCENARIO     idle | active | score | lifecycle | server-change
#   --scenario SCENARIO   Alias for --battle
#   --server-change       Enable mid-test server migration (Scenario E)
#   --api URL             ac-data base URL (default: http://127.0.0.1:3000)
#   --profile progressive Run 10→20→50→100→200→500→1000 progressive test
#   --progressive         Alias for --profile progressive
#   --interval SEC        Override poll interval (debug only)
#   --sse                 Enable SSE on all clients
#   --sse-fraction N      Fraction of clients with SSE (0-1)
#   --confirm             Required for large runs (≥50 clients by default)
#   --output DIR          Report output directory
#   --convex-probe N       N clients perform one sections=full (Convex probe)
#   --full-snapshot-all    All clients probe Convex (expect user_not_found for synthetic IDs)
#
# Safety:
#   Only allowlisted dev/staging hosts (see scripts/hud-load-test/safety.ts).
#   Production api.projectd.space is blocked unless HUD_LOAD_TEST_ALLOW_PROD=1.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  export ASSETTO_ENV_FILE="$ENV_FILE"
fi

if [[ -z "${HUD_API_KEY:-}" ]]; then
  echo "Error: HUD_API_KEY missing in $ENV_FILE"
  exit 1
fi

AC_DATA_DIR="$ROOT/ac-data"
if [[ ! -d "$AC_DATA_DIR/node_modules" ]]; then
  echo "Installing ac-data dependencies (tsx, redis, dotenv)..."
  (cd "$AC_DATA_DIR" && npm install --silent)
fi

exec env NODE_PATH="$AC_DATA_DIR/node_modules" \
  "$AC_DATA_DIR/node_modules/.bin/tsx" "$ROOT/scripts/hud-load-test/run.ts" "$@"
