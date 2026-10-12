#!/bin/bash
# Reload edge + telemetry without killing acServer lobbies.
#
# Use after code changes so new logic loads without ./stop.sh (full).
#
# Usage:
#   ./reload-infra.sh          # defaults to dev (fleet VPS)
#   ./reload-infra.sh dev
#   ./reload-infra.sh prod
#
# Notes:
# - Fleet edges use dev: .env.local + telemetry on host.
# - prod telemetry is Docker image-baked: rebuilds + force-recreates the container.
# - edge runs via tsx watch; a restart still picks up shared/edge changes cleanly.
# - Does NOT touch .env.* files.

set -euo pipefail

ENV_MODE="${1:-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

case "$ENV_MODE" in
  prod|production) ENV_MODE=prod ; COMPOSE=docker-compose.prod.yml ;;
  dev|development) ENV_MODE=dev ; COMPOSE=docker-compose.dev.yml ;;
  *)
    echo -e "${RED}Unknown mode: $ENV_MODE (use prod|dev)${NC}"
    exit 1
    ;;
esac

docker_compose() {
  if command -v sg >/dev/null 2>&1; then
    sg docker -c "docker compose -f $COMPOSE $*"
  else
    docker compose -f "$COMPOSE" "$@"
  fi
}

echo -e "${GREEN}=== reload-infra ($ENV_MODE) ===${NC}"

echo -e "${YELLOW}Stopping infra (keeping acServer)...${NC}"
./stop.sh infra || true
# Brief pause so ports/fds release
sleep 2

echo -e "${YELLOW}Building shared + edge...${NC}"
npm run build:shared
npm run build:edge

if [[ "$ENV_MODE" == "prod" ]]; then
  echo -e "${YELLOW}Rebuilding + recreating telemetry-data container...${NC}"
  docker_compose build telemetry-data
  docker_compose up -d --force-recreate telemetry-data
else
  echo -e "${YELLOW}Dev mode: telemetry starts on host via start.sh${NC}"
fi

echo -e "${YELLOW}Starting edge ($ENV_MODE)...${NC}"
./start.sh "$ENV_MODE" edge

echo -e "${GREEN}=== reload-infra done (lobbies should still be up) ===${NC}"
echo "Check: pgrep -a acServer | head"
echo "Edge log: tail -f logs/ac-data-edge.log"
