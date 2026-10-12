#!/bin/bash
# Stop Assetto Corsa Server Infrastructure
#
# Usage:
#   ./stop.sh              # Stop everything (edge, telemetry, AC lobbies, CM proxies)
#   ./stop.sh force        # Force kill without graceful shutdown
#   ./stop.sh infra        # Stop edge + telemetry only (keep acServer lobbies)
#   ./stop.sh infra force  # Same, force-kill Node/Python

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INFRA_ONLY=false
FORCE=false
for arg in "$@"; do
    case "$arg" in
        infra) INFRA_ONLY=true ;;
        force) FORCE=true ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            echo "Usage: $0 [infra] [force]"
            exit 1
            ;;
    esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$INFRA_ONLY" = true ]; then
    echo -e "${YELLOW}=== Stopping infra only (keeping acServer lobbies) ===${NC}"
else
    echo -e "${YELLOW}=== Stopping Assetto Corsa Services ===${NC}"
fi

# Stop telemetry-data (host + Docker)
echo -e "${YELLOW}Stopping telemetry-data...${NC}"
if [ "$FORCE" = true ]; then
    pkill -9 -f "python3 main.py" 2>/dev/null || true
    pkill -9 -f "python -m main" 2>/dev/null || true
else
    pkill -f "python3 main.py" 2>/dev/null || true
    pkill -f "python -m main" 2>/dev/null || true
fi
sg docker -c "docker compose -f docker-compose.dev.yml stop telemetry-data" 2>/dev/null || true
sg docker -c "docker compose -f docker-compose.prod.yml stop telemetry-data" 2>/dev/null || true
sg docker -c "docker rm -f assetto-telemetry-data" 2>/dev/null || true

# Stop ac-data (Node.js)
echo -e "${YELLOW}Stopping ac-data...${NC}"
if [ "$FORCE" = true ]; then
    pkill -9 -f "tsx.*src/index" 2>/dev/null || true
    pkill -9 -f "node.*dist/index" 2>/dev/null || true
else
    pkill -f "tsx.*src/index" 2>/dev/null || true
    pkill -f "node.*dist/index" 2>/dev/null || true
fi

if [ "$INFRA_ONLY" = true ]; then
    echo -e "${GREEN}=== Infra stopped (acServer + server_pids.json kept) ===${NC}"
    echo ""
    echo "Reload without killing lobbies:"
    echo "  ./reload-infra.sh"
    echo "  ./reload-infra.sh dev"
    exit 0
fi

# Full stop: drop PID bookkeeping and kill game + CM proxies
rm -f "$ROOT_DIR/server_pids.json"

echo -e "${YELLOW}Stopping CM details proxies...${NC}"
"$ROOT_DIR/scripts/stop-cm-proxies.sh" 2>/dev/null || true

echo -e "${YELLOW}Stopping AC servers...${NC}"
if [ "$FORCE" = true ]; then
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
