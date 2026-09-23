#!/usr/bin/env bash
# Structural check: linear separation bar (0..max fill), ahead colors, smooth meters.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

check() {
  if rg -q "$1" "${@:2}" 2>/dev/null; then
    echo "OK: $1"
  else
    echo "FAIL: expected pattern $1"
    fail=1
  fi
}

echo "=== Gap separation bar checks ==="

check 'role == "LEAD"' common/api/battle/battle_phases.lua
check 'role == "CHASE"' common/api/battle/battle_phases.lua
check 'ahead_on_track == true' common/api/battle/battle_phases.lua
check 'ahead_on_track == false' common/api/battle/battle_phases.lua
check 'opponent_ahead' common/api/battle/battle_phases.lua
check 'disappearGapM' common/api/battle/battle_phases.lua
check 'display_ratio' common/battle/gap_anim.lua
check 'display_meters' common/battle/gap_anim.lua
check 'predicted_target_meters' common/battle/gap_anim.lua
check 'draw_separation_fill' common/draw/battle/gap.lua
check 'draw_separation_track' common/draw/battle/gap.lua
check 'RIVAL AHEAD' common/draw/battle/gap.lua
check 'YOU AHEAD' common/draw/battle/gap.lua
check 'line_gap' common/draw/battle/gap.lua
check 'text_block_h' common/draw/battle/gap.lua
check 'DNF' common/draw/battle/gap.lua
check 'HUD_SNAPSHOT_BATTLE_POLL_SEC = 1' common/config.lua

if rg -q '"lead"' common/mock_data.lua && rg -q '"chase"' common/mock_data.lua; then
  echo "OK: mock lead/chase roles"
else
  echo "FAIL: mock lead/chase roles"
  fail=1
fi

if rg -q 'max = 200' common/mock_data.lua; then
  echo "OK: mock disappear gap 200m"
else
  echo "FAIL: mock disappear gap 200m"
  fail=1
fi

if [[ "${fail}" -ne 0 ]]; then
  echo ""
  echo "Verification FAILED"
  exit 1
fi

echo ""
echo "Verification PASSED"
