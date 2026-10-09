#!/bin/bash
# Start N AC server instances via ac-data API, sample host metrics, then stop them.
#
# Usage:
#   ./scripts/load-test-ac-servers.sh --count 12 [--hold 60] [--api http://127.0.0.1:3000]
#   ./scripts/load-test-ac-servers.sh --dry-run   # list servers only
#
# Requires: API_KEY in .env.local (or ASSETTO_ENV_FILE), ac-data running.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVERS_PATH="${SERVERS_PATH:-$ROOT/server}"
COUNT=""
HOLD_SEC=45
API_BASE="http://127.0.0.1:3000"
DRY_RUN=false
RESULTS_DIR="$ROOT/scripts/load-test-results"

usage() {
  sed -n '2,12p' "$0" | tail -n +2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --hold) HOLD_SEC="$2"; shift 2 ;;
    --api) API_BASE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

ENV_FILE="${ASSETTO_ENV_FILE:-$ROOT/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

API_KEY="${API_KEY:-}"
if [[ -z "$API_KEY" && "$DRY_RUN" == false ]]; then
  echo "Error: set API_KEY in .env.local (or ASSETTO_ENV_FILE) or environment"
  exit 1
fi

discover_servers() {
  local names=()
  for dir in "$SERVERS_PATH"/server "$SERVERS_PATH"/server-*; do
    [[ -d "$dir" ]] || continue
    [[ -x "$dir/acServer" || -f "$dir/acServer" ]] || continue
    names+=("$(basename "$dir")")
  done
  printf '%s\n' "${names[@]}" | sort -V
}

mapfile -t ALL_SERVERS < <(discover_servers)
TOTAL="${#ALL_SERVERS[@]}"

if [[ "$TOTAL" -eq 0 ]]; then
  echo "No server folders with acServer under $SERVERS_PATH"
  exit 1
fi

if [[ -z "$COUNT" ]]; then
  COUNT="$TOTAL"
fi

if [[ "$COUNT" -gt "$TOTAL" ]]; then
  echo "Warning: --count $COUNT > available folders ($TOTAL); using $TOTAL"
  COUNT="$TOTAL"
fi

TARGET=("${ALL_SERVERS[@]:0:$COUNT}")

echo "=== AC load test ==="
echo "servers_path=$SERVERS_PATH"
echo "target_count=$COUNT (of $TOTAL folders)"
echo "hold=${HOLD_SEC}s api=$API_BASE"
echo "targets: ${TARGET[*]}"

if [[ "$DRY_RUN" == true ]]; then
  exit 0
fi

api() {
  local method="$1"
  local path="$2"
  curl -s -X "$method" \
    -H "x-api-key: $API_KEY" \
    "${API_BASE}${path}"
}

api_ok() {
  local body
  body="$(api "$@")"
  echo "$body"
  echo "$body" | grep -q '"ok":true'
}

mkdir -p "$RESULTS_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$RESULTS_DIR/run-$STAMP.log"

{
  echo "=== baseline $(date -Is) ==="
  "$ROOT/scripts/vps-capacity-check.sh"
  echo ""
  echo "=== starting $COUNT servers ==="
} | tee "$LOG"

STARTED=()
for name in "${TARGET[@]}"; do
  if resp="$(api_ok POST "/ac-server/servers/${name}/start")"; then
    STARTED+=("$name")
    echo "started $name"
    echo "$resp" >>"$LOG"
  else
    echo "FAILED start $name: $resp"
    echo "$resp" >>"$LOG"
  fi
  sleep 0.5
done

echo "waiting ${HOLD_SEC}s for processes to settle..."
sleep "$HOLD_SEC"

{
  echo ""
  echo "=== under load $(date -Is) ==="
  "$ROOT/scripts/vps-capacity-check.sh"
  echo ""
  echo "=== ac-data status ==="
  api GET "/ac-server/servers" || true
} | tee -a "$LOG"

echo ""
echo "=== stopping started servers ==="
for name in "${STARTED[@]}"; do
  api_ok POST "/ac-server/servers/${name}/stop" >>"$LOG" 2>&1 || true
  sleep 0.3
done

{
  echo ""
  echo "=== after stop $(date -Is) ==="
  "$ROOT/scripts/vps-capacity-check.sh"
} | tee -a "$LOG"

echo ""
echo "Results written to $LOG"
echo "Compare RAM available and acServer count across baseline / under load / after stop."
