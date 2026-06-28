#!/bin/bash
# Assetto Corsa Server - Full Setup Installer
#
# Usage:
#   ./install.sh          # Interactive install
#   ./install.sh --skip-deps  # Skip apt/package installs (already done)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SKIP_DEPS="${1:-}"

echo -e "${GREEN}=== Assetto Corsa Server Installer ===${NC}"

# ──────────────────────────────────────────────
# 1. System Dependencies
# ──────────────────────────────────────────────
if [ "$SKIP_DEPS" != "--skip-deps" ]; then
    echo -e "${YELLOW}Installing system dependencies...${NC}"

    sudo apt update
    sudo apt upgrade -y

    # Core tools
    sudo apt install -y \
        build-essential \
        curl \
        git \
        htop \
        netstat-nat \
        redis-server \
        python3 \
        python3-pip \
        iptables

    echo -e "${GREEN}System dependencies installed${NC}"
else
    echo -e "${YELLOW}Skipping system dependencies${NC}"
fi

# ──────────────────────────────────────────────
# 2. Node.js (nvm)
# ──────────────────────────────────────────────
if ! command -v nvm &> /dev/null; then
    echo -e "${YELLOW}Installing NVM and Node.js...${NC}"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
else
    echo -e "${GREEN}Node.js already installed${NC}"
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
fi

node --version
npm --version

# ──────────────────────────────────────────────
# 3. Python Dependencies
# ──────────────────────────────────────────────
echo -e "${YELLOW}Installing Python dependencies...${NC}"
python3 -m pip install --break-system-packages python-dotenv redis
echo -e "${GREEN}Python dependencies installed${NC}"

# ──────────────────────────────────────────────
# 4. Open Firewall Ports
# ──────────────────────────────────────────────
echo -e "${YELLOW}Opening firewall ports...${NC}"

# AC Server ports (server 0-2)
sudo iptables -A INPUT -p udp --dport 9600 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9600 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 9610 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9610 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 9620 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9620 -j ACCEPT

# AC Server ports (server 3-19)
for port in 9630 9640 9650 9660 9670 9680 9690 9700 9710 9720 9730 9740 9750 9760 9770 9780 9790; do
    sudo iptables -A INPUT -p udp --dport $port -j ACCEPT
    sudo iptables -A INPUT -p tcp --dport $port -j ACCEPT
done

# HTTP Admin ports (8081-8100)
for port in $(seq 8081 8100); do
    sudo iptables -A INPUT -p tcp --dport $port -j ACCEPT
done

# Content Manager details proxy ports (HTTP_PORT + 10000 → 18081-18100)
for port in $(seq 18081 18100); do
    sudo iptables -A INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null || true
done

# ac-data API
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT

# Assetto Manager (optional)
sudo iptables -A INPUT -p tcp --dport 8772 -j ACCEPT

# Plugin ports (UDP) - servers 0-19
for port in 12001 12011 12021 12041 12051 12061 12071 12081 12091 12101 12111 12121 12131 12141 12151 12161 12171 12181 12191 12201; do
    sudo iptables -A INPUT -p udp --dport $port -j ACCEPT
done

# Telemetry UDP listener ports (9000-9020 for all servers)
for port in $(seq 9000 9020); do
    sudo iptables -A INPUT -p udp --dport $port -j ACCEPT 2>/dev/null || true
done

echo -e "${GREEN}Firewall ports opened${NC}"

# ──────────────────────────────────────────────
# 5. ac-data Setup
# ──────────────────────────────────────────────
echo -e "${YELLOW}Setting up ac-data...${NC}"
cd /home/jose/assetto-infra/ac-data
npm install
npm run build
cd ..

# ──────────────────────────────────────────────
# 6. Environment Files
# ──────────────────────────────────────────────
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}Creating .env.local from template...${NC}"
    cp .env.example .env.local
    echo -e "${YELLOW}Please edit .env.local with your credentials${NC}"
fi
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}Tip: for production run: cp .env.example .env.production && nano .env.production${NC}"
fi

# ──────────────────────────────────────────────
# 7. Server Directory Setup
# ──────────────────────────────────────────────
SERVER_DIR="/home/jose/assetto-infra/server"
CONTENT_SOURCE="/home/assetto/server-manager/assetto/content"

if [ -d "$SERVER_DIR" ] && [ ! -L "$SERVER_DIR/server/content/cars" ]; then
    echo -e "${YELLOW}Creating content symlinks...${NC}"
    for instance in server server-1 server-2 server-3 server-4 server-5 server-6 server-7 server-8 server-9 server-10 server-11 server-12 server-13 server-14 server-15 server-16 server-17 server-18 server-19; do
        if [ -d "$SERVER_DIR/$instance" ]; then
            mkdir -p "$SERVER_DIR/$instance/content"
            ln -sf "$CONTENT_SOURCE/cars" "$SERVER_DIR/$instance/content/cars"
            ln -sf "$CONTENT_SOURCE/tracks" "$SERVER_DIR/$instance/content/tracks"
            ln -sf "$CONTENT_SOURCE/weather" "$SERVER_DIR/$instance/content/weather"
            ln -sf "$SERVER_DIR/acServer" "$SERVER_DIR/$instance/acServer"
            ln -sf "$SERVER_DIR/system" "$SERVER_DIR/$instance/system"
            echo "  $instance: done"
        fi
    done
else
    echo -e "${GREEN}Content symlinks already exist${NC}"
fi

# ──────────────────────────────────────────────
# 8. Redis
# ──────────────────────────────────────────────
echo -e "${YELLOW}Starting Redis...${NC}"
if ! pgrep -x redis-server > /dev/null; then
    sudo redis-server --daemonize yes
fi

if redis-cli ping 2>/dev/null | grep -q PONG; then
    echo -e "${GREEN}Redis is running${NC}"
else
    echo -e "${RED}Redis failed to start${NC}"
fi

# ──────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}=== Installation Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env.local (dev) or .env.production (prod) with your credentials"
echo "  2. Run: ./start.sh dev   or   ./start.sh prod"
echo "  3. Check: ./start.sh status"
echo ""
echo "Ports opened:"
echo "  - AC Servers UDP/TCP: 9600-9790 (step 10)"
echo "  - HTTP Admin: 8081-8100"
echo "  - Plugin UDP: 12001-12201 (step 10)"
echo "  - Telemetry: 9000-9020"
echo "  - API: 3000, Manager: 8772"