#!/usr/bin/env bash
# Verify battle_finished Redis → Convex ingest (read-only checks + optional direct probe).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

REDIS_PASSWORD="${REDIS_PASSWORD:-}"
STREAM="${REDIS_STREAM_KEY:-ac:events}"
GROUP="${REDIS_CONSUMER_GROUP:-ac-data-consumers}"
LOG="${ROOT}/ac-data.log"

redis_cmd() {
  if [[ -n "$REDIS_PASSWORD" ]]; then
    redis-cli -a "$REDIS_PASSWORD" --no-auth-warning "$@"
  else
    redis-cli "$@"
  fi
}

echo "=== Redis: recent battle_finished ==="
redis_cmd XREVRANGE "$STREAM" + - COUNT 20 | rg 'battle_finished|battleId' || true

echo ""
echo "=== Redis: consumer group ==="
redis_cmd XINFO GROUPS "$STREAM" 2>/dev/null || echo "(no group)"
echo "--- XPENDING ---"
redis_cmd XPENDING "$STREAM" "$GROUP" 2>/dev/null || echo "(no pending)"

echo ""
echo "=== ac-data: recent ingest failures ==="
if [[ -f "$LOG" ]]; then
  rg -n 'convex batch ingest failed|worker_error.*battle_finished' "$LOG" | tail -10 || echo "(none)"
else
  echo "missing $LOG"
fi

echo ""
echo "=== Direct Convex probe (battle_update + battle_finished batch) ==="
if [[ -z "${CONVEX_INGEST_SECRET:-}" ]]; then
  echo "SKIP: CONVEX_INGEST_SECRET not set"
else
  npx tsx scripts/diag-battle-convex-ingest-batch.ts || {
    echo "FAIL: Convex batch ingest probe returned non-zero"
    exit 1
  }
fi

echo ""
echo "OK: verify-battle-convex-ingest complete"
