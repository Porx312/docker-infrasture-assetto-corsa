#!/usr/bin/env bash
# Compare debug-hud-presence URL vs HUD client URL shapes for /hud/snapshot.
#
# Usage:
#   ./scripts/compare-hud-snapshot-request.sh [STEAM_ID] [CAR_MODEL]
#
# Example (during live battle):
#   ./scripts/compare-hud-snapshot-request.sh 76561199230780195 ks_mazda_rx7_spirit_r
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a
# shellcheck source=lib/hud-steam-defaults.sh
source "$ROOT/scripts/lib/hud-steam-defaults.sh"

STEAM_ID="${1:-$HUD_DEFAULT_STEAM_ID}"
CAR_MODEL="${2:-ks_mazda_rx7_spirit_r}"
API="${STAGING_API_URL:-http://127.0.0.1:3000}"
API="${API%/}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 [STEAM_ID] [CAR_MODEL]"
  exit 1
fi

KEY_QS=""
[[ -n "${HUD_API_KEY:-}" ]] && KEY_QS="&api_key=${HUD_API_KEY}"

URL_DEBUG="${API}/hud/snapshot?steamId=${STEAM_ID}${KEY_QS}"
URL_HUD="${API}/hud/snapshot?steamId=${STEAM_ID}&carFilter=global&carModel=${CAR_MODEL}${KEY_QS}"

summarize() {
  local label="$1"
  local file="$2"
  python3 -c "
import json, sys
label = sys.argv[1]
raw = open(sys.argv[2], encoding='utf-8', errors='replace').read().strip()
try:
    d = json.loads(raw) if raw else {}
except json.JSONDecodeError:
    print(label, 'parse_error', raw[:120])
    sys.exit(0)
print(label, 'http_ok=', d.get('ok'), 'reason=', d.get('reason'))
b = d.get('battle') or {}
if isinstance(b, dict):
    p1 = b.get('player1') or {}
    p2 = b.get('player2') or {}
    print(
        label,
        'battleOk=', b.get('ok'),
        'state=', b.get('state'),
        'battleId=', (b.get('battleId') or '')[:32],
        'rev=', b.get('revision'),
        'score=',
        (p1.get('score') if isinstance(p1, dict) else '?'),
        '-',
        (p2.get('score') if isinstance(p2, dict) else '?'),
    )
" "$label" "$file"
}

TMP_DEBUG="$(mktemp)"
TMP_HUD="$(mktemp)"
trap 'rm -f "$TMP_DEBUG" "$TMP_HUD"' EXIT

echo "=== compare-hud-snapshot-request ==="
echo "steamId=$STEAM_ID carModel=$CAR_MODEL"
echo ""
echo "URL shape A (debug script): steamId + api_key only"
echo "URL shape B (HUD client):   steamId + carFilter=global + carModel + api_key"
echo ""

CODE_A="$(curl -sS -o "$TMP_DEBUG" -w '%{http_code}' "$URL_DEBUG" || echo 000)"
CODE_B="$(curl -sS -o "$TMP_HUD" -w '%{http_code}' "$URL_HUD" || echo 000)"

echo "HTTP A (debug):  $CODE_A"
summarize "A" "$TMP_DEBUG"
echo ""
echo "HTTP B (HUD):    $CODE_B"
summarize "B" "$TMP_HUD"
echo ""

python3 -c "
import json, sys
a = json.load(open(sys.argv[1], encoding='utf-8', errors='replace') or '{}') if open(sys.argv[1]).read().strip() else {}
b = json.load(open(sys.argv[2], encoding='utf-8', errors='replace') or '{}') if open(sys.argv[2]).read().strip() else {}
ba = a.get('battle') if isinstance(a.get('battle'), dict) else {}
bb = b.get('battle') if isinstance(b.get('battle'), dict) else {}
fields = ('ok', 'state', 'battleId', 'revision')
diff = []
for f in fields:
    va = ba.get(f)
    vb = bb.get(f)
    if va != vb:
        diff.append(f'{f}: A={va!r} B={vb!r}')
p1a = (ba.get('player1') or {}).get('score')
p2a = (ba.get('player2') or {}).get('score')
p1b = (bb.get('player1') or {}).get('score')
p2b = (bb.get('player2') or {}).get('score')
if (p1a, p2a) != (p1b, p2b):
    diff.append(f'score: A={p1a}-{p2a} B={p1b}-{p2b}')
if not diff:
    print('RESULT: battle payload IDENTICAL between URL shapes')
else:
    print('RESULT: battle payload DIFFERS')
    for line in diff:
        print(' ', line)
" "$TMP_DEBUG" "$TMP_HUD"
