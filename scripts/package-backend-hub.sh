#!/usr/bin/env bash
# Create a minimal tarball: backend hub + shared only (no full assetto-infra).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist"
STAGE="$OUT_DIR/ac-data-backend-hub-stage"
TARBALL="$OUT_DIR/ac-data-backend-hub.tar.gz"

rm -rf "$STAGE"
mkdir -p "$STAGE/packages"

cp "$ROOT/deploy/backend-hub/package.json" "$STAGE/package.json"
cp "$ROOT/deploy/backend-hub/README.md" "$STAGE/README.md"

rsync -a \
  --exclude node_modules \
  --exclude dist \
  "$ROOT/packages/ac-data-shared/" "$STAGE/packages/ac-data-shared/"

rsync -a \
  --exclude node_modules \
  --exclude dist \
  "$ROOT/packages/ac-data-backend/" "$STAGE/packages/ac-data-backend/"

if [ -d "$ROOT/ProjectD-HUD" ]; then
  rsync -a "$ROOT/ProjectD-HUD/" "$STAGE/ProjectD-HUD/"
fi

# npm on the VPS does not understand pnpm/yarn "workspace:*"; use a file link.
node -e "
const fs = require('fs');
const p = '$STAGE/packages/ac-data-backend/package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
if (j.dependencies && j.dependencies['@projectd/ac-data-shared']) {
  j.dependencies['@projectd/ac-data-shared'] = 'file:../ac-data-shared';
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
"

mkdir -p "$OUT_DIR"
tar -czf "$TARBALL" -C "$STAGE" .
rm -rf "$OUT_DIR/ac-data-backend-hub"
mkdir -p "$OUT_DIR/ac-data-backend-hub"
cp -a "$STAGE/." "$OUT_DIR/ac-data-backend-hub/"
rm -rf "$STAGE"

echo "Created: $TARBALL"
echo "Unpacked: $OUT_DIR/ac-data-backend-hub"
echo "Upload tarball to backend VPS, then: npm install && npm run build && npm start"
