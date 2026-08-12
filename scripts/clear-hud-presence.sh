#!/usr/bin/env bash
# Remove stale ac:hud:presence for a steamId (e.g. after simulate-battle with wrong SERVER_NAME).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a
# shellcheck source=lib/hud-steam-defaults.sh
source "$ROOT/scripts/lib/hud-steam-defaults.sh"

STEAM_ID="${1:-$HUD_DEFAULT_STEAM_ID}"
if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 [STEAM_ID]"
  exit 1
fi

REDIS_CLI=(redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6379}")
[[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")

KEY="ac:hud:presence:${STEAM_ID}"
BEFORE="$("${REDIS_CLI[@]}" GET "$KEY" 2>/dev/null || true)"
"${REDIS_CLI[@]}" DEL "$KEY" >/dev/null
echo "Deleted $KEY"
if [[ -n "$BEFORE" ]]; then
  echo "Was: ${BEFORE:0:120}"
fi
echo "Rejoin the managed server in-game to refresh presence."
