#!/usr/bin/env bash
# Start Caddy in Docker (no sudo). Cloudflare DNS must point to this VPS.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CADDY_ENV="$ROOT_DIR/deploy/caddy/caddy.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$CADDY_ENV" ]; then
  echo -e "${RED}Missing $CADDY_ENV — cp deploy/caddy/caddy.env.example deploy/caddy/caddy.env${NC}"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$CADDY_ENV"
set +a

DOCKER=(docker)
COMPOSE=(docker-compose)
if ! docker info >/dev/null 2>&1; then
  DOCKER=(sg docker -c docker)
  COMPOSE=(sg docker -c docker-compose)
fi

echo -e "${YELLOW}Starting Caddy (Docker, host network)...${NC}"
"${COMPOSE[@]}" -f "$ROOT_DIR/docker-compose.caddy.yml" up -d

echo -e "${GREEN}Caddy running.${NC}"
echo "  API:   https://${STAGING_API_HOST}"
echo "  Admin: https://${STAGING_ADMIN_HOST}"
echo ""
echo -e "${YELLOW}Ensure Cloudflare A records (proxied) → this VPS public IP.${NC}"
echo "  See docs/STAGING_HTTPS.md"
