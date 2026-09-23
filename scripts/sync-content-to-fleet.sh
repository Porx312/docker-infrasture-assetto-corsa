#!/usr/bin/env bash
# Push hub CONTENT_PATH to all fleet edges via admin API (requires CONTENT_FLEET_SYNC_ENABLED on hub).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HUB_URL="${HUB_URL:-http://127.0.0.1:3000}"
DRY_RUN="${DRY_RUN:-false}"

curl -sS -X POST \
  -b "${ADMIN_COOKIE:-}" \
  "${HUB_URL}/admin/content/sync-fleet?dryRun=${DRY_RUN}" \
  -H 'Content-Type: application/json' \
  | python3 -m json.tool

echo ""
echo "Ensure hub env: CONTENT_FLEET_SYNC_ENABLED=true, CONTENT_SYNC_SSH_USER, CONTENT_SYNC_REMOTE_PATH, CONTENT_PATH"
