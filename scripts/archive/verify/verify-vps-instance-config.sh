#!/usr/bin/env bash
# Verify per-VPS instance config before/after cloning a host.
# Usage: ./scripts/verify-vps-instance-config.sh [dev|prod]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_MODE="${1:-${ASSETTO_ENV:-dev}}"
case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *)
    echo "Unknown mode: $ENV_MODE (use dev or prod)"
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL: $ENV_FILE not found (cp .env.example $ENV_FILE)"
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

FAIL=0
warn() { echo "WARN: $*"; }
ok() { echo "OK: $*"; }
fail() { echo "FAIL: $*"; FAIL=1; }

echo "=== VPS instance config ($ENV_FILE) ==="

# Required unique-ish vars
for var in AC_INSTANCE_ID REDIS_CONSUMER_NAME REDIS_CONFIG_CONSUMER_NAME; do
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    fail "$var is empty"
  else
    ok "$var=$val"
  fi
done

if [[ -n "${AC_INSTANCE_ID:-}" && -n "${REDIS_CONSUMER_NAME:-}" ]]; then
  if [[ "$REDIS_CONSUMER_NAME" == *"$AC_INSTANCE_ID"* ]] || [[ "$REDIS_CONSUMER_NAME" == "ac-data-${AC_INSTANCE_ID}" ]]; then
    ok "REDIS_CONSUMER_NAME references instance id"
  else
    warn "REDIS_CONSUMER_NAME ($REDIS_CONSUMER_NAME) does not contain AC_INSTANCE_ID ($AC_INSTANCE_ID) — ensure it is unique in the fleet"
  fi
fi

# Redis connectivity
if [[ -z "${REDIS_HOST:-}" ]]; then
  fail "REDIS_HOST is empty"
else
  REDIS_CLI=(redis-cli -h "$REDIS_HOST")
  [[ -n "${REDIS_PORT:-}" ]] && REDIS_CLI+=(-p "$REDIS_PORT")
  [[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")
  [[ "${REDIS_SSL:-false}" == "true" ]] && REDIS_CLI+=(--tls)
  if "${REDIS_CLI[@]}" PING 2>/dev/null | grep -q PONG; then
    ok "Redis PING at $REDIS_HOST"
  else
    fail "Redis PING failed at $REDIS_HOST"
  fi
fi

# Processes
if pgrep -af "tsx src/index" >/dev/null 2>&1 || pgrep -af "node.*ac-data" >/dev/null 2>&1; then
  ok "ac-data process running on host"
else
  warn "ac-data not running (pgrep tsx src/index)"
fi

if [[ "$ENV_MODE" == "prod" || "$ENV_MODE" == "production" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q telemetry; then
    ok "telemetry Docker container running"
  else
    warn "telemetry Docker container not found (prod expects Docker)"
  fi
fi

# Instance id in recent ac-data log
LOG_FILE="$ROOT/ac-data.log"
if [[ -f "$LOG_FILE" && -n "${AC_INSTANCE_ID:-}" ]]; then
  if tail -n 200 "$LOG_FILE" | grep -q "instance=${AC_INSTANCE_ID}"; then
    ok "ac-data.log mentions instance=${AC_INSTANCE_ID}"
  else
    warn "ac-data.log has no recent instance=${AC_INSTANCE_ID} (restart ac-data after env change?)"
  fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "PASS: instance config checks"
  echo "Next: register AC_INSTANCE_ID=$AC_INSTANCE_ID in Convex worker sync if not done yet."
  echo "See docs/VPS_FLEET_SETUP.md"
  exit 0
fi

echo "FAIL: fix issues above before running battles on a cloned VPS"
exit 1
