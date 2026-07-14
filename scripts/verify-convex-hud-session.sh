#!/usr/bin/env bash
# Query Convex HUD session for a steamId (session-only; no getHudPlayer).
# Usage: ./scripts/verify-convex-hud-session.sh [steamId]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEAM_ID="${1:-76561199230780195}"

if [[ ! -f "${ROOT}/ac-data/dist/services/hud/hudConvex.js" ]]; then
  echo "ac-data dist missing — run: cd ac-data && npm run build"
  exit 1
fi

cd "${ROOT}/ac-data"
ASSETTO_ENV_FILE="${ROOT}/.env.local" node --input-type=module <<EOF
import './dist/config/loadEnv.js';
import { fetchHudSession } from './dist/services/hud/hudConvex.js';

const steamId = '${STEAM_ID}';
console.log('=== Convex getHudSession for', steamId, '===');
const session = await fetchHudSession({ steamId });
console.log(JSON.stringify(session, null, 2));

if (session.ok && session.profile) {
  const p = session.profile;
  console.log('SESSION ok rank=', p.rank, 'elo=', p.elo ?? 'n/a');
  console.log('  isInvalidated=', p.isInvalidated ?? false);
} else if (!session.ok && session.reason === 'player_not_connected') {
  console.log('');
  console.log('Player offline in Convex live_players — for ban check use:');
  console.log('  ./scripts/verify-convex-player-join.sh', steamId);
}
EOF
