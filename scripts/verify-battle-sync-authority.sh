#!/usr/bin/env bash
# Static checks for battle HUD sync authority refactor (server snapshots + client renderer).
#
# Usage: ./scripts/verify-battle-sync-authority.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Battle sync authority checks ==="
echo ""

FETCH="ProjectD-HUD/common/api/battle_fetch.lua"
PARSE="ProjectD-HUD/common/api/battle_parse.lua"
PUB="telemetry-data/network/battle_hud_publisher.py"
SCORING="telemetry-data/engines/battlesystem/scoring.py"
SM="telemetry-data/engines/battlesystem/state_machine.py"

grep -q 'should_ignore_stale_snapshot' "$FETCH" \
  && echo "  OK client rejects stale version/revision" \
  || { echo "  FAIL should_ignore_stale_snapshot missing"; exit 1; }

grep -q 'last_snapshot_revision' "$FETCH" \
  && echo "  OK client tracks last_snapshot_revision" \
  || { echo "  FAIL last_snapshot_revision missing"; exit 1; }

grep -q 'last_revision_battle_id' "$FETCH" \
  && echo "  OK revision guard scoped per battleId" \
  || { echo "  FAIL last_revision_battle_id missing"; exit 1; }

grep -q 'battle_sync_trace' "$FETCH" \
  && echo "  OK [BATTLE_SYNC] trace instrumentation" \
  || { echo "  FAIL battle_sync_trace missing"; exit 1; }

grep -q 'BATTLE_SYNC_TRACE' "$PUB" \
  && echo "  OK server [BATTLE_PUBLISH] trace gate" \
  || grep -q 'BATTLE_SYNC_TRACE' telemetry-data/core/settings.py \
  && echo "  OK server BATTLE_SYNC_TRACE setting" \
  || { echo "  FAIL BATTLE_SYNC_TRACE missing"; exit 1; }

test -x scripts/trace-battle-sync.sh \
  && echo "  OK trace-battle-sync.sh" \
  || { echo "  FAIL scripts/trace-battle-sync.sh missing or not executable"; exit 1; }

! grep -q 'promote_ui_from_live_evidence' "$FETCH" \
  && echo "  OK no local phase promotion from scores" \
  || { echo "  FAIL promote_ui_from_live_evidence still present"; exit 1; }

! grep -q 'apply_live_arming_countdown' "$FETCH" \
  && echo "  OK no local arming countdown interpolation" \
  || { echo "  FAIL apply_live_arming_countdown still present"; exit 1; }

! grep -q 'apply_go_hold_ui' "$FETCH" \
  && echo "  OK no local GO hold state mutation" \
  || { echo "  FAIL apply_go_hold_ui still present"; exit 1; }

grep -q 'apply_presentation_overlay' "$FETCH" \
  && echo "  OK presentation overlay for draw-only effects" \
  || { echo "  FAIL apply_presentation_overlay missing"; exit 1; }

grep -q 'revision = tonumber(raw.revision)' "$PARSE" \
  && echo "  OK battle_parse stores revision" \
  || { echo "  FAIL revision field missing in battle_parse"; exit 1; }

grep -q 'seen_seq' "$PARSE" \
  && echo "  OK pointsLog dedup by seq" \
  || { echo "  FAIL pointsLog seq dedup missing"; exit 1; }

grep -q '_next_revision' "$PUB" \
  && echo "  OK monotonic revision per battleId" \
  || { echo "  FAIL _next_revision missing"; exit 1; }

grep -q 'resolved_state in' "$PUB" \
  && echo "  OK debounce split (no debounce on phase/score/terminal)" \
  || { echo "  FAIL debounce split missing"; exit 1; }

grep -q '"seq"' "$SCORING" \
  && echo "  OK pointsLog seq in scoring append" \
  || { echo "  FAIL seq missing in scoring"; exit 1; }

grep -q '_maybe_notify_arming_countdown' "$SM" \
  && grep -q 'force=True' "$SM" \
  && echo "  OK arming countdown publishes with force" \
  || { echo "  FAIL arming force publish check"; exit 1; }

echo ""
echo "Run unit tests:"
echo "  cd telemetry-data && python3 -m pytest tests/test_battle_hud_publisher.py tests/battlesystem/ -q"
echo ""
