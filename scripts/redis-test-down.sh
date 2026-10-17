#!/usr/bin/env bash
# Stop ephemeral Redis started by scripts/redis-test-up.sh
set -euo pipefail

NAME="${REDIS_TEST_CONTAINER_NAME:-assetto-redis-test}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null
  echo "stopped $NAME"
else
  echo "no container named $NAME"
fi
