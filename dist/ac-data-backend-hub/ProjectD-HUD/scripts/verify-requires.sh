#!/usr/bin/env bash
# Verify all require("common.*") paths resolve to existing Lua modules.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

resolve_module() {
  local path="$1"
  path="${path//./\/}"
  if [[ -f "${path}.lua" ]]; then
    return 0
  fi
  if [[ -f "${path}/init.lua" ]]; then
    return 0
  fi
  return 1
}

echo "=== require path checks ==="

while IFS= read -r req; do
  mod="${req#require(\"}"
  mod="${mod%\")}"
  if [[ "$mod" != common* ]]; then
    continue
  fi
  if resolve_module "$mod"; then
    echo "OK: $mod"
  else
    echo "FAIL: missing module for require(\"$mod\")"
    fail=1
  fi
done < <(rg -o 'require\("common\.[^"]+"\)' --no-filename -g '*.lua' | sort -u)

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Verification FAILED"
  exit 1
fi

echo ""
echo "Verification PASSED"
