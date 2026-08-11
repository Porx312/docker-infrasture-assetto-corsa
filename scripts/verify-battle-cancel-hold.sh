#!/usr/bin/env bash
# Static checks for battle cancel hold UI (client latch + server publish suppress).
#
# Usage: ./scripts/verify-battle-cancel-hold.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Battle cancel hold checks ==="
echo ""

FETCH="ProjectD-HUD/common/api/battle_fetch.lua"
TERMINAL="ProjectD-HUD/common/api/battle/battle_terminal.lua"
CENTER="ProjectD-HUD/common/draw/battle/center.lua"
PAIR="telemetry-data/engines/battlesystem/pair_manager.py"
SM="telemetry-data/engines/battlesystem/state_machine.py"

grep -q 'latch_is_cancel_hold' "$FETCH" \
  && echo "  OK latch_is_cancel_hold helper" \
  || { echo "  FAIL missing latch_is_cancel_hold"; exit 1; }

grep -q 'apply_snapshot ignored (cancel hold)' "$FETCH" \
  && echo "  OK apply_snapshot ignores live snapshots during cancel hold" \
  || { echo "  FAIL cancel hold guard in apply_snapshot"; exit 1; }

grep -q 'latch_is_cancel_hold(now)' "$FETCH" \
  && echo "  OK should_reset skips preempt during cancel hold" \
  || { echo "  FAIL cancel hold guard in should_reset_battle_context"; exit 1; }

grep -q 'store_terminal_latch' "$FETCH" \
  && echo "  OK store_terminal_latch normalizes latch snapshot" \
  || { echo "  FAIL missing store_terminal_latch"; exit 1; }

grep -q 'ensure_cancel_labels' "$TERMINAL" \
  && echo "  OK ensure_cancel_labels in battle_terminal" \
  || { echo "  FAIL missing ensure_cancel_labels"; exit 1; }

grep -q 'format_cancel_reason' "$CENTER" \
  && echo "  OK center.lua cancel_reason fallback" \
  || { echo "  FAIL center.lua cancel_reason fallback missing"; exit 1; }

grep -q 'battle.cancel_reason' "$CENTER" \
  && echo "  OK center.lua reads battle.cancel_reason" \
  || { echo "  FAIL center.lua cancel_reason usage missing"; exit 1; }

grep -q '_mark_hud_cancel_hold' "$PAIR" \
  && echo "  OK pair_manager _mark_hud_cancel_hold" \
  || { echo "  FAIL pair_manager cancel hold missing"; exit 1; }

grep -q '_hud_cancel_hold_until' "$PAIR" \
  && echo "  OK pair_manager suppresses debounced publish during hold" \
  || { echo "  FAIL pair_manager hold suppress missing"; exit 1; }

grep -q '_mark_hud_cancel_hold' "$SM" \
  && echo "  OK state_machine marks cancel hold on arming_aborted" \
  || { echo "  FAIL state_machine arming_aborted hold missing"; exit 1; }

echo ""
echo "Manual repro:"
echo "  1. Start arming countdown, widen gap past abort threshold -> center shows cancel ~5s"
echo "  2. Prestart gap abort -> same"
echo "  3. Separated idle dissolve -> cancel still visible"
echo "  ac.storage('ProjectD-HUD:battle_debug', true):set() — expect 'apply_snapshot ignored (cancel hold)'"
