#!/usr/bin/env bash
# Copy hub packages from assetto-infra (source of truth) → ProjectD-Backend-Servers clone.
# Run after backend/shared/HUD hub changes, before git push / Dokploy deploy / local hub dev.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/ProjectD-Backend-Servers"

if [ ! -d "$DEST/.git" ]; then
  echo "Missing hub clone: $DEST"
  echo "  git clone git@github.com:Porx312/ProjectD-Backend-Servers.git $DEST"
  exit 1
fi

echo "Syncing packages/ac-data-shared → ProjectD-Backend-Servers/packages/ac-data-shared"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  "$ROOT/packages/ac-data-shared/" "$DEST/packages/ac-data-shared/"

echo "Syncing packages/ac-data-backend → ProjectD-Backend-Servers/packages/ac-data-backend"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  "$ROOT/packages/ac-data-backend/" "$DEST/packages/ac-data-backend/"

if [ -d "$ROOT/ProjectD-HUD" ]; then
  echo "Syncing ProjectD-HUD → ProjectD-Backend-Servers/ProjectD-HUD"
  rsync -a --delete \
    --exclude node_modules \
    "$ROOT/ProjectD-HUD/" "$DEST/ProjectD-HUD/"
fi

echo "Done. Hub clone updated from assetto-infra/packages (and ProjectD-HUD)."
echo "Next: cd ProjectD-Backend-Servers && npm run build && npm run dev   # or commit + push"
