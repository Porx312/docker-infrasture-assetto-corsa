#!/usr/bin/env bash
# Apply requirepass from .env.local to system Redis (requires sudo). Restarts redis-server once.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${REDIS_PASSWORD:-}" ]]; then
  echo "REDIS_PASSWORD empty in $ENV_FILE — run scripts/rotate-vps-secrets.sh first" >&2
  exit 1
fi

CONF="/etc/redis/redis.conf"
if ! sudo test -f "$CONF"; then
  echo "Redis config not found at $CONF (need sudo to read /etc/redis/)" >&2
  exit 1
fi

sudo sed -i 's/^requirepass .*/requirepass '"$REDIS_PASSWORD"'/' "$CONF" || true
if ! sudo grep -q '^requirepass ' "$CONF"; then
  echo "requirepass $REDIS_PASSWORD" | sudo tee -a "$CONF" >/dev/null
fi

sudo systemctl restart redis-server
echo "Redis requirepass applied and redis-server restarted."
