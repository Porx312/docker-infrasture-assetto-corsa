#!/usr/bin/env bash
# Run each unit test file in its own process (fresh env/module state).
# Prints ## FAILED FILE <path> on failure so CI can surface the flake without
# scrolling the full TAP stream.
set -euo pipefail

export NODE_ENV=test
export SKIP_ASSETTO_ENV_LOAD=1
unset REDIS_HOST REDIS_URL REDIS_PASSWORD REDIS_PORT REDIS_USERNAME REDIS_DB \
  BACKEND_WORKER_URL BACKEND_INGEST_URL FLEET_EDGE_SECRET \
  CONVEX_DEPLOYMENT_URL CONVEX_URL CONVEX_SELF_HOSTED_URL \
  CONVEX_WORKER_SECRET CONVEX_INGEST_SECRET

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mapfile -t files < <(find test -name '*.test.ts' ! -name '*.integration.test.ts' | sort)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No unit tests found"
  exit 0
fi

pass_files=0
fail_files=0
failed_list=()

for f in "${files[@]}"; do
  echo "## FILE $f"
  if npx tsx --test --test-concurrency=1 "$f"; then
    pass_files=$((pass_files + 1))
  else
    fail_files=$((fail_files + 1))
    failed_list+=("$f")
    echo "## FAILED FILE $f"
  fi
done

echo "## summary files_passed=$pass_files files_failed=$fail_files total_files=${#files[@]}"
if [[ "$fail_files" -ne 0 ]]; then
  echo "## failed files:"
  printf ' - %s\n' "${failed_list[@]}"
  exit 1
fi
