#!/usr/bin/env bash
# Query unified Convex player join context for a steamId.
# Usage: ./scripts/verify-convex-player-join.sh [--expect-invalidated] [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECT_INVALIDATED=false
STEAM_ID="76561199230780195"

for arg in "$@"; do
  case "${arg}" in
    --expect-invalidated)
      EXPECT_INVALIDATED=true
      ;;
    *)
      STEAM_ID="${arg}"
      ;;
  esac
done

if [[ ! -f "${ROOT}/ac-data/dist/services/hud/hudConvex.js" ]]; then
  echo "ac-data dist missing — run: cd ac-data && npm run build"
  exit 1
fi

cd "${ROOT}/ac-data"
ASSETTO_ENV_FILE="${ROOT}/.env.local" node --input-type=module <<EOF
import './dist/config/loadEnv.js';
import { fetchPlayerJoinContext } from './dist/services/hud/hudConvex.js';

const steamId = '${STEAM_ID}';
const expectInvalidated = ${EXPECT_INVALIDATED};

try {
  const context = await fetchPlayerJoinContext(steamId);
  console.log('=== getPlayerJoinContext for', steamId, '===');
  console.log(JSON.stringify(context, null, 2));
  const invalidated =
    (context.ok === false && context.reason === 'user_invalidated') ||
    context.user?.isInvalidated === true ||
    context.user?.is_invalidated === true;
  console.log('');
  console.log('isInvalidated:', invalidated);
  if (context.session) {
    console.log('session:', context.session.ok ? 'ok' : context.session.reason);
  }

  if (expectInvalidated && !invalidated) {
    console.error('');
    console.error('FAIL: expected user_invalidated / isInvalidated=true');
    process.exit(1);
  }
  if (!expectInvalidated && invalidated) {
    console.error('');
    console.error('WARN: user is invalidated in Convex');
  }
} catch (error) {
  console.error('QUERY FAILED:', error instanceof Error ? error.message : error);
  console.error('');
  console.error('Deploy workerPlayers:getPlayerJoinContext in Convex — see docs/CONVEX_PLAYER_JOIN_CONTEXT.md');
  process.exit(1);
}
EOF
