#!/bin/bash
# Stop Assetto Corsa Server Infrastructure

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Stopping Assetto Corsa Services ===${NC}"

# Stop telemetry-data (Docker)
echo -e "${YELLOW}Stopping telemetry-data...${NC}"
docker compose -f docker-compose.dev.yml stop telemetry-data 2>/dev/null || true
docker rm assetto-telemetry-data 2>/dev/null || true

# Stop ac-data (Node.js)
echo -e "${YELLOW}Stopping ac-data...${NC}"
pkill -f "node.*dist/index" 2>/dev/null || true

echo -e "${GREEN}=== All services stopped ===${NC}"