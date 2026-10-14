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

# Refuse to wipe uncommitted work outside server/ (runtime AC binaries/content
# are still tracked historically and get mutated on fleet VPS; reset --hard below).
# Porcelain: XY PATH  |  XY ORIG -> PATH  |  untracked "?? PATH"
non_server_dirty="$(
  git status --porcelain | awk '
    {
      line = $0
      sub(/^.../, "", line)
      if (index(line, " -> ")) {
        split(line, parts, " -> ")
        line = parts[length(parts)]
      }
      gsub(/^"/, "", line)
      gsub(/"$/, "", line)
      if (line !~ /^server\//) print $0
    }
  '
)"
if [[ -n "$non_server_dirty" ]]; then
  echo -e "${RED}Working tree is dirty outside server/. Commit/stash or clean before deploy.${NC}"
  echo "$non_server_dirty"
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "${YELLOW}Ignoring dirty server/ paths (will be reset to origin/main).${NC}"
fi

echo -e "${YELLOW}Fetching origin/main...${NC}"
git fetch origin main
git checkout main
git reset --hard origin/main
echo -e "${GREEN}Now at $(git rev-parse --short HEAD)${NC}"

# Non-interactive SSH (Actions) skips .bashrc — load nvm/node if needed.
ensure_npm() {
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}npm not found (PATH=$PATH). Install Node or fix nvm for this user.${NC}"
    exit 127
  fi
  echo -e "${YELLOW}Using npm via nvm: $(command -v npm)${NC}"
}
ensure_npm

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
