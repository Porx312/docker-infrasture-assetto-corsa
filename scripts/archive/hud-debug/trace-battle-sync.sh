#!/usr/bin/env bash
# Correlate battle HUD sync logs across telemetry-data, ac-data, and CSP client debug.
#
# Usage:
#   # Enable tracing first:
#   #   telemetry: BATTLE_SYNC_TRACE=1 in .env.local, restart ./start.sh dev
#   #   ac-data:   HUD_BATTLE_PUSH_LOG=true
#   #   client:    ac.storage("ProjectD-HUD:battle_sync_trace", true):set()
#   #
#   ./scripts/trace-battle-sync.sh                    # tail live logs
#   ./scripts/trace-battle-sync.sh --since 5m         # last 5 minutes from log files
#   ./scripts/trace-battle-sync.sh path/to/csp.log    # include CSP debug export
#
# Classification hints (plan categories):
#   5/10  REJECT reason=stale_revision with current_battle_id="" after latch clear
#   3/8   SERVER publishes rev sequence with gaps in CLIENT applied lines
#   2     SERVER full sequence, CLIENT missing intermediate revs (LWW / delivery)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TELEMETRY_LOG="${TELEMETRY_LOG:-$ROOT/telemetry-data.log}"
ACDATA_LOG="${ACDATA_LOG:-$ROOT/ac-data.log}"
SINCE=""
CSP_LOG=""

usage() {
  sed -n '2,20p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --since)
      SINCE="${2:-}"
      shift 2
      ;;
    --telemetry-log)
      TELEMETRY_LOG="$2"
      shift 2
      ;;
    --acdata-log)
      ACDATA_LOG="$2"
      shift 2
      ;;
    *)
      if [[ -f "$1" ]]; then
        CSP_LOG="$1"
        shift
      else
        echo "Unknown arg: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

filter_since() {
  local file="$1"
  if [[ -z "$SINCE" ]]; then
    cat "$file"
    return
  fi
  # GNU date: parse relative durations like 5m, 1h, 24h
  local duration="$SINCE"
  if [[ "$duration" =~ ^([0-9]+)(m|h|s)$ ]]; then
    local n="${BASH_REMATCH[1]}"
    local u="${BASH_REMATCH[2]}"
    case "$u" in
      m) duration="${n} minutes" ;;
      h) duration="${n} hours" ;;
      s) duration="${n} seconds" ;;
    esac
  fi
  cutoff="$(date -d "$duration ago" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
  if [[ -z "$cutoff" ]]; then
    echo "warn: --since '$SINCE' not parsed; showing full file" >&2
    cat "$file"
    return
  fi
  awk -v cutoff="$cutoff" '$0 >= cutoff' "$file" 2>/dev/null || cat "$file"
}

emit_section() {
  local title="$1"
  local pattern="$2"
  shift 2
  echo ""
  echo "=== $title ==="
  for src in "$@"; do
    [[ -f "$src" ]] || continue
    filter_since "$src" | grep -E "$pattern" || true
  done
}

summarize() {
  echo ""
  echo "=== Summary ==="
  local pub rejects accepts
  pub=0
  rejects=0
  accepts=0

  if [[ -f "$TELEMETRY_LOG" ]]; then
    pub="$(filter_since "$TELEMETRY_LOG" | grep -c '\[BATTLE_PUBLISH\]' || true)"
  fi

  if [[ -n "$CSP_LOG" && -f "$CSP_LOG" ]]; then
    rejects="$(grep -c '\[BATTLE_SYNC\].*action=REJECT' "$CSP_LOG" || true)"
    accepts="$(grep -c '\[BATTLE_SYNC\].*action=ACCEPT' "$CSP_LOG" || true)"
  fi

  echo "  [BATTLE_PUBLISH] lines (telemetry): $pub"
  if [[ -n "$CSP_LOG" ]]; then
    echo "  [BATTLE_SYNC] ACCEPT: $accepts  REJECT: $rejects"
    echo ""
    echo "  REJECT reasons:"
    grep '\[BATTLE_SYNC\].*action=REJECT' "$CSP_LOG" \
      | sed -n 's/.*reason=\([^ ]*\).*/\1/p' \
      | sort | uniq -c | sort -rn || true
    echo ""
    echo "  Applied timeline (client):"
    grep '\[BATTLE_SYNC\] applied' "$CSP_LOG" \
      | sed -n 's/.*transport=\([^ ]*\).*battleId=\([^ ]*\).*revision=\([^ ]*\).*state=\([^ ]*\).*countdown=\([^ ]*\).*/\1 \2 rev=\3 \4 cd=\5/p' \
      || true
  else
    echo "  (no CSP log — export ac.debug ProjectD-HUD battle_sync from both clients)"
  fi

  echo ""
  echo "LWW note (category 3/8): Redis stores one snapshot per player; intermediate"
  echo "phases shorter than delivery latency may not render. No client-side fill-in."
  echo "If gaps persist after guard fix, consider server-side minimum dwell per HUD phase."
}

if [[ -z "$SINCE" && -z "$CSP_LOG" && -f "$TELEMETRY_LOG" && -f "$ACDATA_LOG" ]]; then
  echo "Tailing $TELEMETRY_LOG and $ACDATA_LOG (Ctrl+C to stop)..."
  echo "Filter: BATTLE_PUBLISH | battle-push | BATTLE_SYNC"
  tail -F "$TELEMETRY_LOG" "$ACDATA_LOG" 2>/dev/null | grep -E 'BATTLE_PUBLISH|battle-push|\[BATTLE_SYNC\]' --line-buffered || true
  exit 0
fi

echo "Battle sync trace — $(date -Is)"
echo "telemetry: $TELEMETRY_LOG"
echo "ac-data:   $ACDATA_LOG"
[[ -n "$CSP_LOG" ]] && echo "csp:       $CSP_LOG"

emit_section "Server publishes" '\[BATTLE_PUBLISH\]' "$TELEMETRY_LOG"
emit_section "ac-data SSE push" 'battle-push' "$ACDATA_LOG"
if [[ -n "$CSP_LOG" ]]; then
  emit_section "Client sync (CSP export)" 'BATTLE_SYNC|BATTLE_FETCH|BATTLE_RAW|BATTLE_REVISION|BATTLE_TRACE|BATTLE_SCORE|BATTLE_RENDER_GATE|BATTLE_POLL' "$CSP_LOG"
fi

summarize
