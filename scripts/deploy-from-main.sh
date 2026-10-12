#!/bin/bash
# Deploy this VPS to origin/main (run on the VPS, usually via GitHub Actions SSH).
#
# Usage:
#   ./scripts/deploy-from-main.sh edge
#   ./scripts/deploy-from-main.sh hub
#
# Does NOT touch .env.production / .env.local.
# Edge deploy reloads infra only (keeps acServer lobbies).

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
  # Fleet VPS run start.sh dev (.env.local + telemetry on host).
  echo -e "${YELLOW}Reloading infra (dev; keep acServer)...${NC}"
  chmod +x reload-infra.sh
  ./reload-infra.sh dev
else
  echo -e "${YELLOW}Building backend (hub)...${NC}"
  npm run build:shared
  npm run build:backend

  echo -e "${YELLOW}Restarting services (dev backend)...${NC}"
  ./stop.sh || true
  ./start.sh dev backend
fi

echo -e "${GREEN}=== deploy-from-main done ($ROLE @ $(git rev-parse --short HEAD)) ===${NC}"
