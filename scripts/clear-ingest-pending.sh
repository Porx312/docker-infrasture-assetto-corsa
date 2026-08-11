#!/usr/bin/env bash
# Clear stale XPENDING entries on the ac-data Redis stream consumer group.
# Unacked PEL messages block forward progress and can leave HUD stuck on
# "Waiting for server registration" when player_join never completes ingest.
#
# Usage:
#   ./scripts/clear-ingest-pending.sh [dev|prod]              # dry-run (default)
#   ./scripts/clear-ingest-pending.sh dev --apply             # XACK idle >= 1h
#   ./scripts/clear-ingest-pending.sh dev --apply --idle-hours 0.5
#   ./scripts/clear-ingest-pending.sh dev --apply --all       # XACK entire PEL
#
# After --apply, restart ac-data: ./stop.sh && ./start.sh dev
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_MODE="${1:-${ASSETTO_ENV:-dev}}"
shift || true

APPLY=false
IDLE_HOURS="1"
ACK_ALL=false
BATCH=500

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true ;;
    --idle-hours) IDLE_HOURS="${2:?}"; shift ;;
    --all) ACK_ALL=true ;;
    --batch) BATCH="${2:?}"; shift ;;
    -h|--help)
      sed -n '1,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *) echo "Unknown mode: $ENV_MODE" >&2; exit 1 ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

REDIS_CLI=(redis-cli)
[[ -n "${REDIS_HOST:-}" ]] && REDIS_CLI+=( -h "$REDIS_HOST" )
[[ -n "${REDIS_PORT:-}" ]] && REDIS_CLI+=( -p "$REDIS_PORT" )
[[ -n "${REDIS_USERNAME:-}" ]] && REDIS_CLI+=( --user "$REDIS_USERNAME" )
[[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=( -a "$REDIS_PASSWORD" )
[[ "${REDIS_SSL:-false}" == "true" ]] && REDIS_CLI+=( --tls )
[[ -n "${REDIS_DB:-}" && "$REDIS_DB" != "0" ]] && REDIS_CLI+=( -n "$REDIS_DB" )

STREAM_KEY="${REDIS_STREAM_KEY:-ac:events}"
GROUP="${REDIS_CONSUMER_GROUP:-ac-data-consumers}"

IDLE_MS="$(python3 - <<PY
hours = float("${IDLE_HOURS}")
print(int(hours * 3600 * 1000))
PY
)"

echo "=== Clear ingest XPENDING (env=${ENV_MODE}) ==="
echo "stream:     ${STREAM_KEY}"
echo "group:      ${GROUP}"
echo "mode:       $([[ "$APPLY" == true ]] && echo APPLY || echo dry-run)"
echo "idle_min_ms: ${IDLE_MS} ($([[ "$ACK_ALL" == true ]] && echo '--all ignores idle threshold' || echo "${IDLE_HOURS}h"))"
echo ""

SUMMARY="$("${REDIS_CLI[@]}" XPENDING "$STREAM_KEY" "$GROUP" 2>/dev/null || true)"
if [[ -z "$SUMMARY" ]]; then
  echo "WARN: XPENDING failed — is Redis up and is group ${GROUP} created?"
  exit 1
fi

echo "--- XPENDING summary ---"
echo "$SUMMARY"
echo ""

TOTAL_PENDING="$(echo "$SUMMARY" | head -1 | tr -d ' ')"
if [[ -z "$TOTAL_PENDING" || "$TOTAL_PENDING" == "0" ]]; then
  echo "OK: no pending messages"
  exit 0
fi

if [[ "$APPLY" != true ]]; then
  echo "Dry-run: would scan PEL in batches of ${BATCH} and XACK entries with idle >= ${IDLE_MS}ms"
  echo "Re-run with --apply to execute. Use --all to ack the entire PEL (${TOTAL_PENDING} entries)."
  exit 0
fi

ACKED=0
SCANNED=0

while true; do
  RAW="$("${REDIS_CLI[@]}" --raw XPENDING "$STREAM_KEY" "$GROUP" - + "$BATCH" 2>/dev/null || true)"
  if [[ -z "$RAW" ]]; then
    break
  fi

  mapfile -t FIELDS <<< "$RAW"
  if [[ "${#FIELDS[@]}" -lt 4 ]]; then
    break
  fi

  IDS=()
  for ((i = 0; i + 3 < ${#FIELDS[@]}; i += 4)); do
    id="${FIELDS[i]}"
    idle="${FIELDS[i + 2]}"
    SCANNED=$((SCANNED + 1))
    if [[ "$ACK_ALL" == true ]] || [[ "$idle" -ge "$IDLE_MS" ]]; then
      IDS+=("$id")
    fi
  done

  if [[ "${#IDS[@]}" -gt 0 ]]; then
    "${REDIS_CLI[@]}" XACK "$STREAM_KEY" "$GROUP" "${IDS[@]}" >/dev/null
    ACKED=$((ACKED + ${#IDS[@]}))
    echo "XACK batch: +${#IDS[@]} (total acked=${ACKED}, scanned=${SCANNED})"
  fi

  if [[ "${#FIELDS[@]}" -lt $((BATCH * 4)) ]]; then
    break
  fi
done

REMAINING="$("${REDIS_CLI[@]}" XPENDING "$STREAM_KEY" "$GROUP" 2>/dev/null | head -1 || echo "?")"
echo ""
echo "Done: acked=${ACKED} scanned=${SCANNED} remaining_pending=${REMAINING}"
echo "Restart ac-data if it was running: ./stop.sh && ./start.sh ${ENV_MODE}"
