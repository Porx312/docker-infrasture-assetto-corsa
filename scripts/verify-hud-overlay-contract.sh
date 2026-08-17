#!/usr/bin/env bash
# Verify WSS contract: hud_version / hud_session / battle events.
# Usage: ./scripts/verify-hud-overlay-contract.sh [steamId] [api_key]
#
# Delegates to verify-hud-ws-contract.sh (legacy SSE /hud/stream removed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "${ROOT}/scripts/verify-hud-ws-contract.sh" "$@"
