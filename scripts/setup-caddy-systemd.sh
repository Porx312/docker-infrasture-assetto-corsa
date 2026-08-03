#!/usr/bin/env bash
# Install Caddy via apt + systemd (requires sudo).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CADDY_DIR="$ROOT_DIR/deploy/caddy"
CADDY_ENV="$CADDY_DIR/caddy.env"
CADDYFILE_SRC="$CADDY_DIR/Caddyfile"
CADDYFILE_DST="/etc/caddy/Caddyfile"
ENV_FILE="/etc/caddy/ac-data.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$CADDY_ENV" ]; then
  echo -e "${RED}Missing $CADDY_ENV${NC}"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$CADDY_ENV"
set +a

for var in STAGING_API_HOST STAGING_ADMIN_HOST AC_DATA_UPSTREAM ACME_EMAIL; do
  if [ -z "${!var:-}" ]; then
    echo -e "${RED}Set $var in deploy/caddy/caddy.env${NC}"
    exit 1
  fi
done

if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
    sudo iptables -A INPUT -p tcp --dport "$port" -j ACCEPT
done

sudo mkdir -p /etc/caddy /etc/systemd/system/caddy.service.d
sudo cp "$CADDYFILE_SRC" "$CADDYFILE_DST"
sudo cp "$CADDY_ENV" "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"
sudo tee /etc/systemd/system/caddy.service.d/override.conf >/dev/null <<EOF
[Service]
EnvironmentFile=$ENV_FILE
EOF

sudo caddy validate --config "$CADDYFILE_DST" --adapter caddyfile
sudo systemctl daemon-reload
sudo systemctl enable caddy
sudo systemctl restart caddy

echo -e "${GREEN}Caddy systemd service running.${NC}"
