#!/bin/bash
# Poll edge /api/health until ready (or timeout with diagnostics).
#
# Usage (from repo root or any cwd):
#   ./scripts/wait-edge-health.sh
#   PORT=3000 TIMEOUT_SEC=60 ./scripts/wait-edge-health.sh
#   ./scripts/wait-edge-health.sh http://127.0.0.1:3000/api/health
#
# Env:
#   PORT          default 3000 (used when URL not passed)
#   TIMEOUT_SEC   default 60
#   INTERVAL_SEC  default 2

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-3000}"
TIMEOUT_SEC="${TIMEOUT_SEC:-60}"
INTERVAL_SEC="${INTERVAL_SEC:-2}"
HEALTH_URL="${1:-http://127.0.0.1:${PORT}/api/health}"
EDGE_LOG="${EDGE_LOG:-$ROOT_DIR/logs/ac-data-edge.log}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

dump_diagnostics() {
  echo -e "${RED}=== edge health failed: ${HEALTH_URL} ===${NC}"
  echo -e "${YELLOW}--- processes ---${NC}"
  # Do not match bare `ac-data-edge` (hits orphan `tsx --test …/ac-data-edge/*.test.ts`).
  pgrep -af 'tsx watch.*src/index|ac-data-edge/dist/index|packages/ac-data-edge/src/index' \
    | grep -vE -- '--test|\.test\.ts|\.integration\.test\.ts' \
    || echo "(no matching edge server process)"
  echo -e "${YELLOW}--- listeners (port ${PORT}) ---${NC}"
  if command -v ss >/dev/null 2>&1; then
    ss -lntp 2>/dev/null | grep -E ":${PORT}\\b" || echo "(nothing listening on ${PORT})"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || echo "(nothing listening on ${PORT})"
  else
    echo "(ss/lsof not available)"
  fi
  echo -e "${YELLOW}--- tail ${EDGE_LOG} ---${NC}"
  if [[ -f "$EDGE_LOG" ]]; then
    tail -n 80 "$EDGE_LOG" || true
  else
    echo "(log missing: $EDGE_LOG)"
  fi
}

echo -e "${YELLOW}Waiting for edge health: ${HEALTH_URL} (timeout ${TIMEOUT_SEC}s)...${NC}"

deadline=$((SECONDS + TIMEOUT_SEC))
while (( SECONDS < deadline )); do
  if curl -fsS --connect-timeout 2 --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo -e "${GREEN}Edge health OK: ${HEALTH_URL}${NC}"
    exit 0
  fi
  sleep "$INTERVAL_SEC"
done

dump_diagnostics
exit 1
