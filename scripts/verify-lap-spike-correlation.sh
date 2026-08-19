#!/usr/bin/env bash
# Correlate lap_completed Redis events with ac-data HUD logs and Convex query stats
# in a time window. Use after a prod spike (e.g. ~106 getHudSession/min) or dev lap test.
#
# Usage:
#   ./scripts/verify-lap-spike-correlation.sh --from '2026-08-19 12:42:00' --to '2026-08-19 12:46:00'
#   ./scripts/verify-lap-spike-correlation.sh --anchor-ms 1787136240000   # T ± 2 min
#   ./scripts/verify-lap-spike-correlation.sh --last-minutes 10
#   ./scripts/verify-lap-spike-correlation.sh --from ... --to ... --env prod
#
# Prod spike reference (honorable-ptarmigan-477, operator report):
#   2026-08-19 12:44:00 CEST → anchor-ms 1787136240000 (UTC 10:44:00)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_MODE="${ASSETTO_ENV:-dev}"
FROM_STR=""
TO_STR=""
ANCHOR_MS=""
LAST_MINUTES=""
STREAM_COUNT=5000
LOG_FILE="$ROOT/ac-data.log"
DRY_STATS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM_STR="$2"; shift 2 ;;
    --to) TO_STR="$2"; shift 2 ;;
    --anchor-ms) ANCHOR_MS="$2"; shift 2 ;;
    --last-minutes) LAST_MINUTES="$2"; shift 2 ;;
    --count) STREAM_COUNT="$2"; shift 2 ;;
    --log) LOG_FILE="$2"; shift 2 ;;
    --env) ENV_MODE="$2"; shift 2 ;;
    --no-stats) DRY_STATS=1; shift ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *) echo "Unknown env: $ENV_MODE"; exit 1 ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

REDIS_CLI=(redis-cli)
[[ -n "${REDIS_HOST:-}" ]] && REDIS_CLI+=(-h "$REDIS_HOST")
[[ -n "${REDIS_PORT:-}" ]] && REDIS_CLI+=(-p "$REDIS_PORT")
[[ -n "${REDIS_USERNAME:-}" ]] && REDIS_CLI+=("--user" "$REDIS_USERNAME")
[[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")
[[ "${REDIS_SSL:-false}" == "true" ]] && REDIS_CLI+=(--tls)
[[ -n "${REDIS_DB:-}" && "$REDIS_DB" != "0" ]] && REDIS_CLI+=(-n "$REDIS_DB")

STREAM_KEY="${REDIS_STREAM_KEY:-ac:events}"
GROUP="${REDIS_CONSUMER_GROUP:-ac-data-consumers}"
BASE_URL="${AC_DATA_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
SECRET="${CONVEX_WORKER_SECRET:-}"

parse_window() {
  python3 - "$FROM_STR" "$TO_STR" "$ANCHOR_MS" "$LAST_MINUTES" <<'PY'
import sys
from datetime import datetime, timedelta, timezone

from_str, to_str, anchor_ms, last_minutes = sys.argv[1:5]

def local_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Europe/Madrid")
    except Exception:
        return timezone(timedelta(hours=2))

tz = local_tz()

if last_minutes:
    now = datetime.now(tz)
    to_dt = now
    from_dt = now - timedelta(minutes=int(last_minutes))
elif anchor_ms:
    t = int(anchor_ms)
    from_ms = t - 120_000
    to_ms = t + 120_000
    print(from_ms)
    print(to_ms)
    print(t)
    sys.exit(0)
else:
    if not from_str or not to_str:
        print("ERROR: provide --from/--to, --anchor-ms, or --last-minutes", file=sys.stderr)
        sys.exit(1)
    fmt = "%Y-%m-%d %H:%M:%S"
    from_dt = datetime.strptime(from_str, fmt).replace(tzinfo=tz)
    to_dt = datetime.strptime(to_str, fmt).replace(tzinfo=tz)

from_ms = int(from_dt.timestamp() * 1000)
to_ms = int(to_dt.timestamp() * 1000)
print(from_ms)
print(to_ms)
print("")
PY
}

readarray -t WINDOW <<< "$(parse_window)"
FROM_MS="${WINDOW[0]}"
TO_MS="${WINDOW[1]}"
ANCHOR_T="${WINDOW[2]:-}"

echo "=== Lap ↔ getHudSession spike correlation ==="
echo "env=$ENV_MODE stream=$STREAM_KEY group=$GROUP instance=${AC_INSTANCE_ID:-default}"
echo "window_ms=[$FROM_MS, $TO_MS]"
if [[ -n "$ANCHOR_T" ]]; then
  echo "anchor_ms=$ANCHOR_T (prod spike ref: 2026-08-19 12:44:00 CEST = 1787136240000)"
fi
python3 - "$FROM_MS" "$TO_MS" <<'PY'
import sys
from datetime import datetime, timezone, timedelta
from_ms, to_ms = int(sys.argv[1]), int(sys.argv[2])
try:
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Europe/Madrid")
except Exception:
    tz = timezone(timedelta(hours=2))
def fmt(ms):
    return datetime.fromtimestamp(ms/1000, tz=tz).strftime("%Y-%m-%d %H:%M:%S %Z")
print(f"window_local=[{fmt(from_ms)}, {fmt(to_ms)}]")
PY
echo ""

echo "--- Redis preflight ---"
if ! "${REDIS_CLI[@]}" PING >/dev/null 2>&1; then
  echo "ERROR: redis unreachable"
  exit 1
fi
echo "XLEN $STREAM_KEY: $("${REDIS_CLI[@]}" XLEN "$STREAM_KEY" 2>/dev/null || echo '?')"
echo "XPENDING $GROUP:"
"${REDIS_CLI[@]}" XPENDING "$STREAM_KEY" "$GROUP" 2>/dev/null || echo "(group missing?)"
echo ""

echo "--- Redis events in window (last $STREAM_COUNT scanned) ---"
REDIS_TMP="$(mktemp)"
trap 'rm -f "$REDIS_TMP"' EXIT
"${REDIS_CLI[@]}" --raw XREVRANGE "$STREAM_KEY" + - COUNT "$STREAM_COUNT" 2>/dev/null > "$REDIS_TMP" || true
python3 - "$FROM_MS" "$TO_MS" "$REDIS_TMP" <<'PY'
import json, sys
from collections import Counter

from_ms = int(sys.argv[1])
to_ms = int(sys.argv[2])
with open(sys.argv[3], errors="replace") as f:
    raw = f.read()

entries = []
lines = raw.splitlines()
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if "-" in line and line.split("-")[0].isdigit():
        stream_id = line
        fields = {}
        i += 1
        while i + 1 < len(lines):
            k = lines[i].strip()
            if "-" in k and k.split("-")[0].isdigit():
                break
            v = lines[i + 1].strip() if i + 1 < len(lines) else ""
            fields[k] = v
            i += 2
        payload_raw = fields.get("payload") or fields.get("data") or ""
        try:
            payload = json.loads(payload_raw) if payload_raw.startswith("{") else {}
        except json.JSONDecodeError:
            payload = {}
        ts = payload.get("ts")
        if ts is None:
            try:
                ts = int(fields.get("ts", 0))
            except (TypeError, ValueError):
                ts = None
        if ts is None:
            continue
        if ts < from_ms or ts > to_ms:
            continue
        event = payload.get("event") or fields.get("event") or "?"
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        entries.append({
            "streamId": stream_id,
            "ts": ts,
            "event": event,
            "serverName": payload.get("serverName") or fields.get("serverName") or "",
            "steamId": data.get("steamId") or "",
            "lapTime": data.get("lapTime"),
            "isPersonalBest": data.get("isPersonalBest"),
        })
        continue
    i += 1

entries.sort(key=lambda e: e["ts"])
counts = Counter(e["event"] for e in entries)
lap_rows = [e for e in entries if e["event"] == "lap_completed"]

print(f"entries_in_window={len(entries)}")
for ev, n in counts.most_common():
    print(f"  {ev}: {n}")

print("")
print(f"lap_completed={len(lap_rows)}")
if lap_rows:
    pb_true = sum(1 for e in lap_rows if e.get("isPersonalBest") is True)
    pb_false = sum(1 for e in lap_rows if e.get("isPersonalBest") is False)
    pb_unset = len(lap_rows) - pb_true - pb_false
    print(f"  isPersonalBest: true={pb_true} false={pb_false} unset={pb_unset}")
    distinct_steam = len({e["steamId"] for e in lap_rows if e["steamId"]})
    print(f"  distinct_steamIds={distinct_steam}")
    print("")
    print("streamId | ts | steamId | lapTime | isPB | serverName")
    for e in lap_rows[:30]:
        print(
            f"{e['streamId']} | {e['ts']} | {e['steamId']} | {e.get('lapTime')} | "
            f"{e.get('isPersonalBest')} | {e['serverName']}"
        )
    if len(lap_rows) > 30:
        print(f"... ({len(lap_rows) - 30} more lap_completed omitted)")

# Classification hint
print("")
lap_n = counts.get("lap_completed", 0)
if lap_n == 0:
    print("HINT: no lap_completed in window — widen --count or adjust time range")
elif lap_n >= 50:
    print(f"HINT: {lap_n} laps in window — spike may be load (~{lap_n} ingest/min), not 1-lap fan-out")
elif lap_n <= 5:
    print(f"HINT: {lap_n} lap(s) in window with Convex spike ~106 → likely fan-out inside ProjectD ingest")
PY

echo ""
echo "--- ac-data.log pattern counts (full file; lines lack timestamps) ---"
if [[ -f "$LOG_FILE" ]]; then
  python3 - "$LOG_FILE" <<'PY'
import re, sys
path = sys.argv[1]
patterns = {
    "hud-lap-post-ingest": r"\[hud-lap-post-ingest\]",
    "hud-lap-patch_only": r"\[hud-lap-post-ingest\].*action=patch_only",
    "hud-lap-invalidate": r"\[hud-lap-post-ingest\].*action=invalidate_cache",
    "refresh-user": r"\[hud-worker\] refresh-user",
    "refresh-user-done": r"\[hud-worker\] refresh-user done",
    "hud-push-fetch": r"\[hud-push\] fetchHudSession",
    "redis-lap": r"event=lap_completed",
    "convex-batch-fail": r"convex batch ingest failed",
    "reclaim": r"reclaim|xAutoClaim",
}
text = open(path, errors="replace").read()
for name, pat in patterns.items():
    print(f"  {name}: {len(re.findall(pat, text))}")
print("")
print("Recent lap / HUD lines (last 15):")
lines = [ln for ln in text.splitlines() if re.search(
    r"hud-lap-post-ingest|refresh-user|event=lap_completed|hud-push\] fetchHudSession", ln)]
for ln in lines[-15:]:
    print(f"  {ln[:200]}")
PY
else
  echo "WARN: log not found: $LOG_FILE"
fi

echo ""
if [[ "$DRY_STATS" -eq 0 && -n "$SECRET" ]]; then
  echo "--- convex-query-stats (ac-data process counters) ---"
  curl -sfS "$BASE_URL/hud/worker/convex-query-stats" \
    -H "X-Worker-Secret: $SECRET" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
q=d.get('queries',{})
print(json.dumps(d, indent=2))
sess=q.get('fetchHudSession',0)
join=q.get('fetchPlayerJoinContext',0)
lap_post=0  # filled externally
print('')
print(f'fetchHudSession={sess} fetchPlayerJoinContext={join} total={d.get(\"total\",0)}')
print(f'wsConnected={d.get(\"wsConnected\",0)} since={d.get(\"since\",\"?\")}')
if join > 0 and sess <= join * 2:
    print('LIKELY: ac-data session fetches track webhook/join volume (not O(N) idle)')
elif sess > join * 5 and join <= 3:
    print('LIKELY: Convex dashboard counts internal getHudSession in ingest (not ac-data refresh-user)')
"
else
  echo "Skip stats (--no-stats or CONVEX_WORKER_SECRET missing)"
fi

echo ""
echo "--- Decision tree (manual) ---"
echo "  1 lap, 0-3 refresh-user, spike ~106 on Convex → ProjectD ingest internal getHudSession loop"
echo "  1 lap, ~N refresh-user distinct steamIds → Convex webhook fan-out → ac-data joinContext"
echo "  ~106 lap_completed in window → normal load; check if each lap triggers 1+ Convex session query"
echo "  patch_only in hud-lap-post-ingest + spike → ac-data is NOT direct caller on non-PB path"
echo ""
echo "Re-run after controlled lap: ./scripts/simulate-lap-completed.sh STEAM --lap-ms SLOW_MS"
echo "Delta stats: ./scripts/verify-hud-convex-query-volume.sh (before/after)"
