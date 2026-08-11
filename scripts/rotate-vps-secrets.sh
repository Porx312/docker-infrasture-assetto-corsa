#!/usr/bin/env bash
# Rotate local VPS secrets in .env.local (admin, HUD, Redis). Does not rotate Convex/Steam — see docs/VPS_SECURITY_HARDENING.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

rand() { openssl rand -base64 "$1" | tr -d '/+=' | head -c "$1"; }

HUD_KEY="hud-$(rand 32)"
ADMIN_PASS="$(rand 24)"
JWT_SECRET="$(rand 48)"
REDIS_PASS="$(rand 32)"

set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

set_kv HUD_API_KEY "$HUD_KEY"
set_kv ADMIN_PASS "$ADMIN_PASS"
set_kv ADMIN_JWT_SECRET "$JWT_SECRET"
set_kv REDIS_PASSWORD "$REDIS_PASS"

chmod 600 "$ENV_FILE"

echo "Updated $ENV_FILE (mode 600)."
echo "Rotated: HUD_API_KEY, ADMIN_PASS, ADMIN_JWT_SECRET, REDIS_PASSWORD"
echo "Save ADMIN_PASS offline; update HUD overlay config with new HUD_API_KEY."
echo "Apply Redis auth: sudo ./scripts/apply-redis-local-auth.sh"
echo "Restart stack: ./stop.sh && ./start.sh dev"
echo "Convex/Steam rotation: manual — see docs/VPS_SECURITY_HARDENING.md"
