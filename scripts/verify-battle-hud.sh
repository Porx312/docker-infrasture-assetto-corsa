#!/usr/bin/env bash
# Verify unified HUD WSS stream (requires ac-data running + HUD_API_KEY).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/scripts/verify-hud-ws-contract.sh" "$@"
