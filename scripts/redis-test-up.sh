#!/usr/bin/env bash
# Ephemeral Redis for integration tests only (bound to localhost:16379).
# Never use shared/prod Redis. Tear down with scripts/redis-test-down.sh
set -euo pipefail

NAME="${REDIS_TEST_CONTAINER_NAME:-assetto-redis-test}"
PORT="${REDIS_TEST_PORT:-16379}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — install Docker or point REDIS_TEST_HOST at an isolated instance" >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "already running: $NAME on 127.0.0.1:${PORT}"
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null
fi

docker run --rm -d \
  --name "$NAME" \
  -p "127.0.0.1:${PORT}:6379" \
  redis:7-alpine

echo "Redis test up: REDIS_TEST_HOST=127.0.0.1 REDIS_TEST_PORT=${PORT}"
echo "Run: REDIS_TEST_HOST=127.0.0.1 REDIS_TEST_PORT=${PORT} SKIP_REDIS_INTEGRATION=0 npm run test:integration -w @projectd/ac-data-edge"
