#!/bin/bash
# Deploy this VPS to origin/main (run on the VPS, usually via GitHub Actions SSH).
#
# Usage:
#   ./scripts/deploy-from-main.sh edge
#   ./scripts/deploy-from-main.sh hub
#
# Does NOT touch .env.production / .env.local.

set -euo pipefail

ROLE="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  echo "Usage: $0 <edge|hub>"
  exit 1
}

case "$ROLE" in
  edge|hub) ;;
  *) usage ;;
esac

echo -e "${GREEN}=== deploy-from-main ($ROLE) ===${NC}"
echo "Repo: $ROOT_DIR"

# Refuse to wipe uncommitted tracked/untracked work (env files are gitignored).
if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "${RED}Working tree is dirty. Commit/stash or clean before deploy.${NC}"
  git status --porcelain
  exit 1
fi

echo -e "${YELLOW}Fetching origin/main...${NC}"
git fetch origin main
git checkout main
git reset --hard origin/main
echo -e "${GREEN}Now at $(git rev-parse --short HEAD)${NC}"

echo -e "${YELLOW}npm ci...${NC}"
npm ci

if [[ "$ROLE" == "edge" ]]; then
  echo -e "${YELLOW}Building edge...${NC}"
  npm run build:edge

  echo -e "${YELLOW}Rebuilding telemetry-data (prod compose)...${NC}"
  if command -v sg >/dev/null 2>&1; then
    sg docker -c "docker compose -f docker-compose.prod.yml build telemetry-data redis" || true
  else
    docker compose -f docker-compose.prod.yml build telemetry-data redis || true
  fi

  echo -e "${YELLOW}Restarting services (prod edge)...${NC}"
  ./stop.sh || true
  ./start.sh prod edge
else
  echo -e "${YELLOW}Building backend (hub)...${NC}"
  npm run build:shared
  npm run build:backend

  echo -e "${YELLOW}Restarting services (prod backend)...${NC}"
  ./stop.sh || true
  # start.sh target is "backend" (hub role)
  ./start.sh prod backend
fi

echo -e "${GREEN}=== deploy-from-main done ($ROLE @ $(git rev-parse --short HEAD)) ===${NC}"
