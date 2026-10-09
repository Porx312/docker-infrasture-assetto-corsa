#!/usr/bin/env bash
# Diagnose periodic ingestWorkerEventsBatch bursts (~5 min): stream event mix,
# XPENDING backlog, telemetry heartbeat config, and ac-data reclaim settings.
#
# Usage: ./scripts/verify-ingest-burst.sh [dev|prod] [streamSampleCount]
#
# Classification (printed at end):
#   A — player_join / lap_completed dominate (unregistered user backlog)
#   B — server_status dominates (empty heartbeat → Convex noise)
#   C — XPENDING backlog + reclaim amplification
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_MODE="${1:-${ASSETTO_ENV:-dev}}"
SAMPLE_COUNT="${2:-40}"

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *) echo "Unknown mode: $ENV_MODE"; exit 1 ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

REDIS_CLI=(redis-cli)
if [[ -n "${REDIS_HOST:-}" ]]; then
  REDIS_CLI+=( -h "$REDIS_HOST" )
fi
if [[ -n "${REDIS_PORT:-}" ]]; then
  REDIS_CLI+=( -p "$REDIS_PORT" )
fi
if [[ -n "${REDIS_USERNAME:-}" ]]; then
  REDIS_CLI+=( --user "$REDIS_USERNAME" )
fi
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  REDIS_CLI+=( -a "$REDIS_PASSWORD" )
fi
if [[ "${REDIS_SSL:-false}" == "true" ]]; then
  REDIS_CLI+=( --tls )
fi
if [[ -n "${REDIS_DB:-}" && "$REDIS_DB" != "0" ]]; then
  REDIS_CLI+=( -n "$REDIS_DB" )
fi

STREAM_KEY="${REDIS_STREAM_KEY:-ac:events}"
GROUP="${REDIS_CONSUMER_GROUP:-ac-data-consumers}"

echo "=== Ingest burst diagnostic (env=$ENV_MODE stream=$STREAM_KEY group=$GROUP) ==="
echo ""

echo "--- 1/6 Effective env (heartbeat + ingest) ---"
echo "SERVER_STATUS_HEARTBEAT_INTERVAL_SEC=${SERVER_STATUS_HEARTBEAT_INTERVAL_SEC:-300 (default)}"
echo "SERVER_STATUS_HEARTBEAT_WHEN_EMPTY=${SERVER_STATUS_HEARTBEAT_WHEN_EMPTY:-false (default)}"
echo "SERVER_STATUS_ON_CHANGE_ONLY=${SERVER_STATUS_ON_CHANGE_ONLY:-true (default)}"
echo "WORKER_INGEST_FLUSH_INTERVAL_MS=${WORKER_INGEST_FLUSH_INTERVAL_MS:-5000 (default)}"
echo "REDIS_PENDING_RECLAIM_INTERVAL_MS=${REDIS_PENDING_RECLAIM_INTERVAL_MS:-310000 (default)}"
echo "INGEST_SKIP_EMPTY_SERVER_STATUS=${INGEST_SKIP_EMPTY_SERVER_STATUS:-true (default)}"
echo ""

echo "--- 2/6 Telemetry-bound UDP servers (server folders) ---"
SERVER_DIRS=()
for d in "$ROOT"/server "$ROOT"/server-*; do
  [[ -d "$d/cfg" ]] && SERVER_DIRS+=("$d")
done
echo "server_instance_dirs=${#SERVER_DIRS[@]}"
if [[ ${#SERVER_DIRS[@]} -gt 0 && ${#SERVER_DIRS[@]} -le 25 ]]; then
  printf '  %s\n' "${SERVER_DIRS[@]##*/}"
fi
echo ""

echo "--- 3/6 Redis stream: last $SAMPLE_COUNT entries by event type ---"
if ! "${REDIS_CLI[@]}" PING >/dev/null 2>&1; then
  echo "ERROR: redis unreachable (REDIS_HOST=${REDIS_HOST:-localhost})"
  exit 1
fi

RAW="$("${REDIS_CLI[@]}" XREVRANGE "$STREAM_KEY" + - COUNT "$SAMPLE_COUNT" 2>/dev/null || true)"
if [[ -z "$RAW" ]]; then
  echo "WARN: stream empty or XREVRANGE failed"
else
  python3 - "$RAW" <<'PY'
import json, re, sys
raw = sys.argv[1]
events = []
for m in re.finditer(r'"event"\s*:\s*"([^"]+)"', raw):
    events.append(m.group(1))
if not events:
    for line in raw.splitlines():
        if line.startswith("event") or '"event"' in line:
            events.append(line.strip())
from collections import Counter
c = Counter(events)
print(f"sampled_entries={len(events)} unique_types={len(c)}")
for ev, n in c.most_common():
    print(f"  {ev}: {n}")
PY
fi
echo ""

echo "--- 4/6 Consumer group XPENDING ---"
"${REDIS_CLI[@]}" XPENDING "$STREAM_KEY" "$GROUP" 2>/dev/null || echo "WARN: XPENDING failed (group missing?)"
echo ""
echo "XINFO GROUPS $STREAM_KEY:"
"${REDIS_CLI[@]}" XINFO GROUPS "$STREAM_KEY" 2>/dev/null | head -40 || true
echo ""

echo "--- 5/6 Recent ac-data bridge logs ---"
LOG="$ROOT/ac-data.log"
if [[ -f "$LOG" ]]; then
  grep -E 'redis-bridge|convex batch|user_not_found|reclaimed|skipped Convex' "$LOG" 2>/dev/null | tail -30 || echo "(no matching lines)"
else
  echo "WARN: $LOG not found"
fi
echo ""

echo "--- 6/6 Classification hint ---"
python3 - "$RAW" <<'PY'
import json, re, sys
raw = sys.argv[1] if len(sys.argv) > 1 else ""
from collections import Counter
events = [m.group(1) for m in re.finditer(r'"event"\s*:\s*"([^"]+)"', raw)]
c = Counter(events)
if not c:
    print("INSUFFICIENT_DATA — re-run during a burst window or increase sample count")
    sys.exit(0)
top = c.most_common(3)
labels = []
if c.get("player_join", 0) + c.get("lap_completed", 0) >= max(3, c.get("server_status", 0)):
    labels.append("A (player_join/lap backlog — unregistered users in PEL/stream)")
if c.get("server_status", 0) >= max(3, c.get("player_join", 0)):
    labels.append("B (empty server_status heartbeats → Convex ingest noise)")
if not labels:
    labels.append("MIXED — inspect XPENDING and ac-data.log reclaim lines")
print("Likely: " + "; ".join(labels))
print("If XPENDING[0] > 0 and grows every ~5 min → also C (PEL reclaim amplification)")
PY

echo ""
echo "Re-run during the burst minute for best signal. Watch: tail -f ac-data.log | rg 'redis-bridge|user_not_found'"
