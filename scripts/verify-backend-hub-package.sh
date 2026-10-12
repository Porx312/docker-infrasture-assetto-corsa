#!/usr/bin/env bash
# Pack hub tarball, assert contents match current SoT, then npm ci + build in an isolated dir.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL="$ROOT/dist/ac-data-backend-hub.tar.gz"
VERIFY_ROOT="${TMPDIR:-/tmp}/ac-data-backend-hub-verify-$$"

die() {
  echo "verify-backend-hub-package: $*" >&2
  exit 1
}

echo "==> Packaging hub..."
"$ROOT/scripts/package-backend-hub.sh"

[[ -f "$TARBALL" ]] || die "missing tarball: $TARBALL"

echo "==> Checking tarball contents..."
LIST="$(tar -tzf "$TARBALL")"

assert_absent() {
  local pattern="$1"
  if echo "$LIST" | grep -qE "$pattern"; then
    die "tarball still contains forbidden path matching: $pattern"
  fi
}

assert_present() {
  local path="$1"
  if ! echo "$LIST" | grep -qx "./$path" && ! echo "$LIST" | grep -qx "$path"; then
    # tar may list with or without ./
    if ! echo "$LIST" | grep -qE "(^|/)${path}$"; then
      die "tarball missing required path: $path"
    fi
  fi
}

assert_absent 'activityFleetMerge'
assert_absent 'manifestExtract'
assert_absent 'hashUtil'
# Ghost shared dist artifact (no src counterpart) — AUD2-10
assert_absent 'resolveIngestServerName'

assert_present 'packages/ac-data-shared/src/services/edgeIngestForward.ts'
assert_present 'packages/ac-data-shared/src/services/secrets/fleetSecrets.ts'
assert_present 'packages/ac-data-backend/src/controller/activityController.ts'

# Spot-check activity controller source inside the archive
CTRL_TMP="$(mktemp)"
tar -xOzf "$TARBALL" ./packages/ac-data-backend/src/controller/activityController.ts >"$CTRL_TMP" 2>/dev/null \
  || tar -xOzf "$TARBALL" packages/ac-data-backend/src/controller/activityController.ts >"$CTRL_TMP"
grep -q 'fetchMergedFleetServers' "$CTRL_TMP" || die "activityController missing fetchMergedFleetServers"
if grep -q 'activityFleetMerge' "$CTRL_TMP"; then
  die "activityController still references activityFleetMerge"
fi
rm -f "$CTRL_TMP"

echo "==> Isolated install + build in $VERIFY_ROOT ..."
rm -rf "$VERIFY_ROOT"
mkdir -p "$VERIFY_ROOT"
tar -xzf "$TARBALL" -C "$VERIFY_ROOT"

(
  cd "$VERIFY_ROOT"
  # Prefer lockfile from packaged tree if present; otherwise generate one.
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build

  if grep -R --include='*.ts' --include='*.js' -l 'activityFleetMerge' packages 2>/dev/null; then
    die "built tree still contains activityFleetMerge"
  fi

  node --input-type=module -e "
    import { fleetEdgeSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';
    if (typeof fleetEdgeSecret !== 'function') {
      console.error('fleetEdgeSecret export missing');
      process.exit(1);
    }
    console.log('fleetEdgeSecret export OK');
  "
)

rm -rf "$VERIFY_ROOT"
echo "verify-backend-hub-package: OK ($TARBALL)"
