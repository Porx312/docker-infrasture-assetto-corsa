#!/bin/bash
# Start Assetto Corsa Server Infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Assetto Corsa Server Infrastructure ===${NC}"

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo -e "${RED}Error: .env.local not found${NC}"
    echo "Copy .env.example to .env.local and configure it first:"
    echo "  cp .env.example .env.local"
    echo "  nano .env.local"
    exit 1
fi

# Load environment variables
source .env.local

# Function to check if a process is running
is_running() {
    pgrep -f "$1" > /dev/null 2>&1
}

# Start Redis if not running
echo -e "${YELLOW}Checking Redis...${NC}"
if is_running "redis-server"; then
    echo -e "${GREEN}Redis is already running${NC}"
else
    echo -e "${YELLOW}Starting Redis...${NC}"
    redis-server --daemonize yes
    echo -e "${GREEN}Redis started${NC}"
fi

# Start telemetry-data (Docker)
echo -e "${YELLOW}Starting telemetry-data (Docker)...${NC}"
if docker ps | grep -q assetto-telemetry-data; then
    echo -e "${GREEN}telemetry-data is already running${NC}"
    docker restart assetto-telemetry-data
else
    docker compose -f docker-compose.dev.yml up -d telemetry-data
    echo -e "${GREEN}telemetry-data started${NC}"
fi

# Start ac-data (Node.js on host)
echo -e "${YELLOW}Starting ac-data (Node.js)...${NC}"
if is_running "node.*dist/index"; then
    echo -e "${GREEN}ac-data is already running${NC}"
else
    cd ac-data
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
    fi
    if [ ! -d "dist" ]; then
        echo -e "${YELLOW}Building...${NC}"
        npm run build
    fi
    node dist/index.js > ac-data.log 2>&1 &
    echo -e "${GREEN}ac-data started (PID: $!)${NC}"
    cd ..
fi

echo -e "${GREEN}=== All services started ===${NC}"
echo ""
echo "Services:"
echo "  - telemetry-data: $(docker ps --filter name=assetto-telemetry-data --format '{{.Status}}')"
echo "  - ac-data: $(is_running 'node.*dist/index' && echo 'running' || echo 'stopped')"
echo "  - Redis: $(is_running 'redis-server' && echo 'running' || echo 'stopped')"
echo ""
echo "Logs:"
echo "  - telemetry-data: docker logs -f assetto-telemetry-data"
echo "  - ac-data: tail -f ac-data.log"
echo "  - Redis events: redis-cli xlen ac:events"