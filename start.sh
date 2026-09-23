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
AC_DATA_TARGET="${2:-edge}"

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

# Export env for child processes (ac-data, start-telemetry.sh)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ASSETTO_ENV_FILE="$ROOT_DIR/$ENV_FILE"
case "$ENV_MODE" in
    prod|production) export ASSETTO_ENV=prod ;;
    *) export ASSETTO_ENV=dev ;;
esac
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

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

# Start telemetry-data (host for dev, Docker for prod)
echo -e "${YELLOW}Starting telemetry-data...${NC}"
if [ "$ENV_MODE" = "dev" ]; then
    if pgrep -f "python3 main.py" > /dev/null 2>&1; then
        echo -e "${GREEN}telemetry-data is already running${NC}"
    else
        nohup ./start-telemetry.sh > telemetry-data.log 2>&1 &
        echo -e "${GREEN}telemetry-data started (host)${NC}"
    fi
else
    if sg docker -c "docker ps -a --filter name=assetto-telemetry-data --format '{{.Names}}'" 2>/dev/null | grep -q assetto-telemetry-data; then
        if sg docker -c "docker ps --filter name=assetto-telemetry-data --format '{{.Names}}'" 2>/dev/null | grep -q assetto-telemetry-data; then
            echo -e "${GREEN}telemetry-data is running${NC}"
        else
            echo -e "${YELLOW}Restarting telemetry-data...${NC}"
            sg docker -c "docker compose -f $DOCKER_COMPOSE up -d telemetry-data"
            echo -e "${GREEN}telemetry-data started${NC}"
        fi
    else
        sg docker -c "docker compose -f $DOCKER_COMPOSE up -d telemetry-data"
        echo -e "${GREEN}telemetry-data started${NC}"
    fi
fi

# Node workspaces (edge / backend)
if [ ! -d "$ROOT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing npm workspaces...${NC}"
    (cd "$ROOT_DIR" && npm install 2>&1 | tail -5)
fi

start_ac_data_edge() {
    echo -e "${YELLOW}Starting ac-data-edge...${NC}"
    if pgrep -f "packages/ac-data-edge.*tsx.*index" >/dev/null 2>&1 || pgrep -f "ac-data-edge/dist/index" >/dev/null 2>&1; then
        echo -e "${GREEN}ac-data-edge is already running${NC}"
        return
    fi
    nohup env ASSETTO_ENV="$ASSETTO_ENV" ASSETTO_ENV_FILE="$ASSETTO_ENV_FILE" \
        npm run dev -w @projectd/ac-data-edge > "$ROOT_DIR/ac-data.log" 2>&1 &
    echo -e "${GREEN}ac-data-edge started (log: ac-data.log)${NC}"
}

start_ac_data_backend() {
    echo -e "${YELLOW}Starting ac-data-backend...${NC}"
    if pgrep -f "packages/ac-data-backend.*tsx.*index" >/dev/null 2>&1; then
        echo -e "${GREEN}ac-data-backend is already running${NC}"
        return
    fi
    nohup env ASSETTO_ENV="$ASSETTO_ENV" ASSETTO_ENV_FILE="$ASSETTO_ENV_FILE" \
        npm run dev -w @projectd/ac-data-backend > "$ROOT_DIR/ac-data-backend.log" 2>&1 &
    echo -e "${GREEN}ac-data-backend started (log: ac-data-backend.log)${NC}"
}

case "$AC_DATA_TARGET" in
    edge|"")
        start_ac_data_edge
        ;;
    backend)
        start_ac_data_backend
        ;;
    all)
        start_ac_data_edge
        start_ac_data_backend
        ;;
    *)
        echo -e "${RED}Unknown ac-data target: $AC_DATA_TARGET (use edge|backend|all)${NC}"
        exit 1
        ;;
esac

# Start Content Manager details proxies (sidecar HTTP for /api/details)
echo -e "${YELLOW}Starting CM details proxies...${NC}"
chmod +x "$ROOT_DIR/scripts/start-cm-proxies.sh" 2>/dev/null || true
"$ROOT_DIR/scripts/start-cm-proxies.sh" || echo -e "${YELLOW}CM proxies not started (see server/shared/cm-proxy-logs)${NC}"

echo -e "${GREEN}=== All services started ===${NC}"
echo ""
echo "Services:"
echo "  - telemetry-data: $(pgrep -f 'python3 main.py' > /dev/null 2>&1 && echo 'running (host)' || echo 'stopped')"
echo "  - ac-data-edge: $(pgrep -f 'ac-data-edge' >/dev/null 2>&1 && echo 'running' || echo 'stopped')"
echo "  - ac-data-backend: $(pgrep -f 'ac-data-backend' >/dev/null 2>&1 && echo 'running' || echo 'stopped')"
echo "  - Redis: $([ "$ENV_MODE" = "dev" ] && (is_running 'redis-server' && echo 'running (local)' || echo 'stopped') || echo 'Cloud (external)')"
echo ""
echo "Logs:"
echo "  - telemetry-data: tail -f telemetry-data.log"
echo "  - ac-data: tail -f ac-data.log"
echo "  - Redis events: redis-cli xlen ac:events"
echo ""
echo "Access:"
echo "  - Server Manager UI: http://localhost:8080"
echo "  - ac-data API: http://localhost:3000"