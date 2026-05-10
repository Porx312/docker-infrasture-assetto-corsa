#!/bin/bash
# Start Assetto Corsa Server Infrastructure
#
# Usage:
#   ./start.sh dev     # Development mode (local Redis)
#   ./start.sh prod    # Production mode (Redis Cloud)
#   ./start.sh         # Defaults to development

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENV_MODE="${1:-dev}"

echo -e "${GREEN}=== Assetto Corsa Server Infrastructure ===${NC}"
echo -e "${BLUE}Mode: ${ENV_MODE}${NC}"

# Determine which env file to use
case "$ENV_MODE" in
    prod|production)
        ENV_FILE=".env.production"
        DOCKER_COMPOSE="docker-compose.prod.yml"
        ;;
    dev|development|"")
        ENV_FILE=".env.local"
        DOCKER_COMPOSE="docker-compose.dev.yml"
        ;;
    *)
        echo -e "${RED}Unknown mode: $ENV_MODE${NC}"
        echo "Usage: $0 [dev|prod]"
        exit 1
        ;;
esac

echo -e "${YELLOW}Using env file: ${ENV_FILE}${NC}"

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: $ENV_FILE not found${NC}"
    echo "Copy .env.example to $ENV_FILE and configure it first:"
    echo "  cp .env.example $ENV_FILE"
    echo "  nano $ENV_FILE"
    exit 1
fi

# Load environment variables
source "$ENV_FILE"

# Function to check if a process is running
is_running() {
    pgrep -f "$1" > /dev/null 2>&1
}

# Start Redis if not running (only for dev mode, prod uses Redis Cloud)
echo -e "${YELLOW}Checking Redis...${NC}"
if [ "$ENV_MODE" = "dev" ]; then
    if is_running "redis-server"; then
        echo -e "${GREEN}Redis is already running${NC}"
    else
        echo -e "${YELLOW}Starting Redis (local)...${NC}"
        redis-server --daemonize yes
        echo -e "${GREEN}Redis started${NC}"
    fi
else
    echo -e "${YELLOW}Using Redis Cloud (no local Redis needed)${NC}"
fi

# Start telemetry-data (Docker)
echo -e "${YELLOW}Starting telemetry-data (Docker)...${NC}"
if docker ps -a --filter name=assetto-telemetry-data --format '{{.Names}}' | grep -q assetto-telemetry-data; then
    if docker ps --filter name=assetto-telemetry-data --format '{{.Names}}' | grep -q assetto-telemetry-data; then
        echo -e "${GREEN}telemetry-data is running${NC}"
    else
        echo -e "${YELLOW}Restarting telemetry-data...${NC}"
        docker compose -f "$DOCKER_COMPOSE" up -d telemetry-data
        echo -e "${GREEN}telemetry-data started${NC}"
    fi
else
    docker compose -f "$DOCKER_COMPOSE" up -d telemetry-data
    echo -e "${GREEN}telemetry-data started${NC}"
fi

# Start ac-data (Node.js on host)
echo -e "${YELLOW}Starting ac-data (Node.js)...${NC}"
if is_running "tsx.*src/index"; then
    echo -e "${GREEN}ac-data is already running${NC}"
else
    cd ac-data
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install 2>&1 | tail -5
    fi
    nohup ./node_modules/.bin/tsx src/index.ts > ../ac-data.log 2>&1 &
    AC_PID=$!
    echo -e "${GREEN}ac-data started (PID: $AC_PID)${NC}"
    cd ..
fi

echo -e "${GREEN}=== All services started ===${NC}"
echo ""
echo "Services:"
echo "  - telemetry-data: $(docker ps --filter name=assetto-telemetry-data --format '{{.Status}}' 2>/dev/null || echo 'stopped')"
echo "  - ac-data: $(is_running 'tsx.*src/index' && echo 'running' || echo 'stopped')"
echo "  - Redis: $([ "$ENV_MODE" = "dev" ] && (is_running 'redis-server' && echo 'running (local)' || echo 'stopped') || echo 'Cloud (external)')"
echo ""
echo "Logs:"
echo "  - telemetry-data: docker logs -f assetto-telemetry-data"
echo "  - ac-data: tail -f ac-data.log"
echo "  - Redis events: redis-cli xlen ac:events"
echo ""
echo "Access:"
echo "  - Server Manager UI: http://localhost:8080"
echo "  - ac-data API: http://localhost:3000"