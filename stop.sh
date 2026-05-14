#!/bin/bash
# Stop Assetto Corsa Server Infrastructure
#
# Usage:
#   ./stop.sh        # Stop all services
#   ./stop.sh force  # Force kill without graceful shutdown

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FORCE="${1:-}"

echo -e "${YELLOW}=== Stopping Assetto Corsa Services ===${NC}"

# Stop telemetry-data (Docker)
echo -e "${YELLOW}Stopping telemetry-data...${NC}"
sg docker -c "docker compose -f docker-compose.dev.yml stop telemetry-data" 2>/dev/null || true
sg docker -c "docker compose -f docker-compose.prod.yml stop telemetry-data" 2>/dev/null || true
sg docker -c "docker rm -f assetto-telemetry-data" 2>/dev/null || true

# Stop ac-data (Node.js)
echo -e "${YELLOW}Stopping ac-data...${NC}"
if [ "$FORCE" = "force" ]; then
    pkill -9 -f "tsx.*src/index" 2>/dev/null || true
    pkill -9 -f "node.*dist/index" 2>/dev/null || true
else
    pkill -f "tsx.*src/index" 2>/dev/null || true
    pkill -f "node.*dist/index" 2>/dev/null || true
fi

# Remove stale PID file
rm -f /home/jose/assetto-infra/server_pids.json

# Stop AC servers
echo -e "${YELLOW}Stopping AC servers...${NC}"
if [ "$FORCE" = "force" ]; then
    killall -9 acServer 2>/dev/null || true
else
    killall acServer 2>/dev/null || true
fi

echo -e "${GREEN}=== All services stopped ===${NC}"
echo ""
echo "Note: Redis is still running (if you want to stop it):"
echo "  redis-cli shutdown"
echo ""
echo "To start again:"
echo "  ./start.sh dev     # Development mode"
echo "  ./start.sh prod    # Production mode"