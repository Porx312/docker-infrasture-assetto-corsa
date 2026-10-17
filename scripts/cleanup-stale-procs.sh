#!/usr/bin/env bash
# List (and optionally kill) stale Node/tsx/CM/telemetry/hung-test processes on a fleet VPS.
# Never touches acServer, Redis, or Cursor remote (cursor-server).
#
# Usage:
#   ./scripts/cleanup-stale-procs.sh           # dry-run (default)
#   ./scripts/cleanup-stale-procs.sh --apply  # kill allowlisted orphans
#
# After --apply, if the edge is down: ./reload-infra.sh

set -euo pipefail

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (use --apply or --help)" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Kill/inventory patterns (same family as stop.sh infra + hung unit tests).
# Never match acServer / redis / cursor-server.
ALLOWLIST_PATTERNS=(
  'cm-details-proxy\.mjs'
  'tsx.*src/index'
  'node.*dist/index'
  'python3 main\.py'
  'python -m main'
  '\.test\.js'
  '\.test\.ts'
)

# Patterns that indicate a *separate* orphan instance (not children of one tsx watch tree).
# For tsx, only the shell wrapper counts — not `node …/tsx watch` children.
LEADER_PATTERNS=(
  'cm-details-proxy\.mjs'
  'sh -c tsx watch'
  'node.*dist/index'
  'python3 main\.py'
  'python -m main'
  '\.test\.js'
  '\.test\.ts'
)

is_forbidden_cmd() {
  local cmd="$1"
  case "$cmd" in
    *acServer*|*redis-server*|*redis-sentinel*|*cursor-server*)
      return 0
      ;;
  esac
  return 1
}

# Collect matching PIDs (unique), skip forbidden cmdlines.
collect_matches() {
  local pat pid cmd
  declare -A seen=()
  for pat in "${ALLOWLIST_PATTERNS[@]}"; do
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      pid="${line%% *}"
      cmd="${line#* }"
      [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]] && continue
      if is_forbidden_cmd "$cmd"; then
        continue
      fi
      # Skip this script / pgrep noise
      case "$cmd" in
        *cleanup-stale-procs.sh*) continue ;;
      esac
      if [[ -z "${seen[$pid]+x}" ]]; then
        seen[$pid]=1
        printf '%s\t%s\n' "$pid" "$cmd"
      fi
    done < <(pgrep -af "$pat" 2>/dev/null || true)
  done
}

rss_mb() {
  local pid="$1" rss
  rss="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -z "$rss" ]]; then
    echo "?"
    return
  fi
  awk -v r="$rss" 'BEGIN { printf "%.1f", r/1024 }'
}

echo "=== Memory ==="
free -h 2>/dev/null || true
echo ""

echo "=== Protected (will never kill) ==="
pgrep -af 'acServer|redis-server' 2>/dev/null | head -20 || echo "(none matched)"
echo ""

mapfile -t MATCHES < <(collect_matches | sort -n)
echo "=== Allowlisted candidates (node/tsx/CM/telemetry/tests) ==="
if [[ ${#MATCHES[@]} -eq 0 ]]; then
  echo "(none)"
else
  declare -A leader_counts=()
  for row in "${MATCHES[@]}"; do
    pid="${row%%$'\t'*}"
    cmd="${row#*$'\t'}"
    mb="$(rss_mb "$pid")"
    tag=""
    for pat in "${ALLOWLIST_PATTERNS[@]}"; do
      if [[ "$cmd" =~ $pat ]]; then
        tag="[$pat]"
        break
      fi
    done
    for pat in "${LEADER_PATTERNS[@]}"; do
      if [[ "$cmd" =~ $pat ]]; then
        leader_counts[$pat]=$((${leader_counts[$pat]:-0} + 1))
        break
      fi
    done
    printf '  PID %s  %s MB  %s  %s\n' "$pid" "$mb" "$tag" "$cmd"
  done
  echo ""
  echo "=== Duplicate leaders (count > 1 = likely stale accumulation) ==="
  any_dup=false
  for pat in "${LEADER_PATTERNS[@]}"; do
    c="${leader_counts[$pat]:-0}"
    if [[ "$c" -gt 1 ]]; then
      echo "  $pat → $c instances"
      any_dup=true
    fi
  done
  if [[ "$any_dup" == false ]]; then
    echo "  (none — one tsx-watch tree / one of each service is normal)"
  fi
fi

echo ""
if [[ "$APPLY" != true ]]; then
  echo "Dry-run only. Re-run with --apply to kill allowlisted candidates above."
  echo "Then if edge health fails: ./reload-infra.sh"
  exit 0
fi

echo "=== Applying kills (allowlist only) ==="
killed=0
for pat in "${ALLOWLIST_PATTERNS[@]}"; do
  if pgrep -af "$pat" >/dev/null 2>&1; then
    echo "  pkill -f '$pat'"
    pkill -f "$pat" 2>/dev/null || true
    killed=1
  fi
done

# CM proxy pid files
PID_DIR="$ROOT/server/shared/cm-proxy-pids"
if [[ -d "$PID_DIR" ]]; then
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -f "$pid_file" ]] || continue
    rm -f "$pid_file"
  done
fi

sleep 1
echo ""
echo "=== Remaining allowlisted processes ==="
mapfile -t LEFT < <(collect_matches | sort -n)
if [[ ${#LEFT[@]} -eq 0 ]]; then
  echo "(none)"
else
  for row in "${LEFT[@]}"; do
    pid="${row%%$'\t'*}"
    cmd="${row#*$'\t'}"
    printf '  PID %s  %s\n' "$pid" "$cmd"
  done
fi

echo ""
echo "=== Memory after ==="
free -h 2>/dev/null || true

EDGE_UP=false
if curl -sf --max-time 2 "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 \
  || curl -sf --max-time 2 "http://127.0.0.1:${PORT:-3000}/health" >/dev/null 2>&1; then
  EDGE_UP=true
fi

echo ""
if [[ "$EDGE_UP" == true ]]; then
  echo "Edge still answering on :${PORT:-3000} — OK."
else
  echo "Edge does not look healthy on :${PORT:-3000}."
  echo "Bring it back (keeps acServer lobbies):"
  echo "  ./reload-infra.sh"
  echo "  ./reload-infra.sh dev"
fi

if [[ "$killed" -eq 1 ]]; then
  echo "Done."
else
  echo "Nothing matched allowlist to kill."
fi
