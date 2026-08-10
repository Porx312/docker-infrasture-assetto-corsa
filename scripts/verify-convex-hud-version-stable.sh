#!/usr/bin/env bash
# Compare getHudVersion + getHudSession twice — versions must be stable when data unchanged.
# Usage: ./scripts/verify-convex-hud-version-stable.sh [steamId]
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
import { fetchHudSession, fetchHudVersion } from './dist/services/hud/hudConvex.js';

const steamId = '${STEAM_ID}';
const now = Date.now();

const v1 = await fetchHudVersion({ steamId, now });
const s1 = await fetchHudSession({ steamId });
await new Promise((r) => setTimeout(r, 500));
const v2 = await fetchHudVersion({ steamId, now: Date.now() });
const s2 = await fetchHudSession({ steamId });

function versionLine(label, v) {
  if (!v.ok) return \`\${label}: ERROR \${v.reason}\`;
  return \`\${label}: version=\${v.version} lbVersion=\${v.lbVersion} playerVersion=\${v.playerVersion}\`;
}

function sessionLine(label, s) {
  if (!s.ok) return \`\${label}: ERROR \${s.reason}\`;
  return \`\${label}: version=\${s.version} rank=\${s.profile?.rank ?? 'n/a'}\`;
}

console.log('=== Convex version stability for', steamId, '===');
console.log(versionLine('getHudVersion #1', v1));
console.log(versionLine('getHudVersion #2', v2));
console.log(sessionLine('getHudSession #1', s1));
console.log(sessionLine('getHudSession #2', s2));

let ok = true;
if (v1.ok && v2.ok && v1.version !== v2.version) {
  console.log('FAIL: getHudVersion changed between polls (unstable — thrashes snapshot/SSE cache)');
  ok = false;
}
if (s1.ok && s2.ok && s1.version !== s2.version) {
  console.log('FAIL: getHudSession.version changed between polls');
  ok = false;
}
if (ok) {
  console.log('OK: version strings stable across back-to-back queries');
}
process.exit(ok ? 0 : 1);
EOF
