#!/usr/bin/env bash
# Watch Redis battle snapshot versions vs ac-data logs during a stuck/slow HUD repro.
#
# Usage: ./scripts/verify-battle-live-sync.sh STEAM_ID [dev|prod] [interval_sec] [samples]
#
# Run while both players see MATCHMAKING but battle should be active.
# Enable overlay debug: ProjectD-HUD:battle_debug = true
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STEAM_ID="${1:-}"
ENV_MODE="${2:-${ASSETTO_ENV:-dev}}"
INTERVAL="${3:-2}"
SAMPLES="${4:-15}"

if [[ -z "$STEAM_ID" ]]; then
  echo "Usage: $0 STEAM_ID [dev|prod] [interval_sec] [samples]"
  exit 1
fi

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *) echo "Unknown mode: $ENV_MODE"; exit 1 ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

INSTANCE="${AC_INSTANCE_ID:-default}"
REDIS_CLI=(redis-cli)
[[ -n "${REDIS_HOST:-}" ]] && REDIS_CLI+=(-h "$REDIS_HOST")
[[ -n "${REDIS_PORT:-}" ]] && REDIS_CLI+=(-p "$REDIS_PORT")
[[ -n "${REDIS_USERNAME:-}" ]] && REDIS_CLI+=(--user "$REDIS_USERNAME")
[[ -n "${REDIS_PASSWORD:-}" ]] && REDIS_CLI+=(-a "$REDIS_PASSWORD")
[[ "${REDIS_SSL:-false}" == "true" ]] && REDIS_CLI+=(--tls)
[[ -n "${REDIS_DB:-}" && "$REDIS_DB" != "0" ]] && REDIS_CLI+=(-n "$REDIS_DB")

LOG="$ROOT/ac-data.log"
TELEMETRY_LOG="$ROOT/telemetry-data.log"

echo "=== Battle live sync watch (steamId=$STEAM_ID instance=$INSTANCE) ==="
echo "Samples every ${INTERVAL}s x ${SAMPLES}. Ctrl+C to stop early."
echo ""
echo "Overlay: enable ProjectD-HUD:battle_debug for client-side apply_snapshot logs."
echo "Correlate with: tail -f telemetry-data.log | rg 'LAUNCHING|ACTIVE|pre-active|pair dissolved'"
echo "                tail -f ac-data.log | rg 'battle-push|hud-updates'"
echo ""

find_battle_key() {
  "${REDIS_CLI[@]}" --scan --pattern "ac:hud:battle:${INSTANCE}_*:${STEAM_ID}" 2>/dev/null | head -n 1
}

PREV_VER=""
for ((i = 1; i <= SAMPLES; i++)); do
  KEY="$(find_battle_key || true)"
  TS="$(date -u +%H:%M:%S)"
  if [[ -z "$KEY" ]]; then
    echo "[$TS] sample=$i redis_key=(none) state=- version=-"
  else
    RAW="$("${REDIS_CLI[@]}" GET "$KEY" 2>/dev/null || true)"
    PARSED="$(python3 -c "
import json, sys
raw = sys.stdin.read()
if not raw.strip():
    print('-|-')
    sys.exit(0)
try:
    d = json.loads(raw)
    print(f\"{d.get('state','?')}|{d.get('version','?')}\")
except Exception:
    print('parse_err|-')
" <<< "$RAW")"
    STATE="${PARSED%%|*}"
    VER="${PARSED#*|}"
    DELTA=""
    if [[ -n "$PREV_VER" && "$VER" != "$PREV_VER" && "$VER" != "?" ]]; then
      DELTA=" (version changed)"
    fi
    PREV_VER="$VER"
    echo "[$TS] sample=$i key=${KEY##ac:hud:battle:} state=$STATE version=$VER$DELTA"
  fi

  if [[ -f "$LOG" ]]; then
    PUSH="$(grep -E 'battle-push|pushBattle|hud-updates-subscriber' "$LOG" 2>/dev/null | tail -n 1 || true)"
    [[ -n "$PUSH" ]] && echo "  ac-data: ${PUSH:0:120}"
  fi
  if [[ -f "$TELEMETRY_LOG" ]]; then
    TM="$(grep -E 'LAUNCHING|ACTIVE|pre-active|pair dissolved|publish' "$TELEMETRY_LOG" 2>/dev/null | tail -n 1 || true)"
    [[ -n "$TM" ]] && echo "  telemetry: ${TM:0:120}"
  fi

  [[ "$i" -lt "$SAMPLES" ]] && sleep "$INTERVAL"
done

echo ""
echo "--- Source checks (battle start sync) ---"
grep -q 'arming_violation_active' telemetry-data/engines/battlesystem/rules/arming.py \
  && echo "  OK arming gap hysteresis (arming_violation_active)" \
  || { echo "  FAIL missing arming_violation_active"; exit 1; }
grep -q 'BATTLE_ARM_ABORT_GAP_METERS' telemetry-data/core/settings.py \
  && echo "  OK BATTLE_ARM_ABORT_GAP_METERS configured" \
  || { echo "  FAIL missing abort gap setting"; exit 1; }
grep -q 'prepPhase' telemetry-data/network/battle_hud_publisher.py \
  && echo "  OK prepPhase in battle snapshots" \
  || { echo "  FAIL prepPhase missing"; exit 1; }
grep -q 'rival_paired' ProjectD-HUD/common/api/battle/battle_phases.lua \
  && echo "  OK rival_paired exits matchmaking UI" \
  || { echo "  FAIL rival_paired missing"; exit 1; }
grep -q 'should_ignore_stale_snapshot' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK snapshot version/revision guard" \
  || { echo "  FAIL should_ignore_stale_snapshot missing"; exit 1; }
grep -q 'apply_presentation_overlay' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK presentation-only overlay (no local countdown gameplay)" \
  || { echo "  FAIL apply_presentation_overlay missing"; exit 1; }
grep -q '! promote_ui_from_live_evidence' ProjectD-HUD/common/api/battle_fetch.lua 2>/dev/null \
  || ! grep -q 'promote_ui_from_live_evidence' ProjectD-HUD/common/api/battle_fetch.lua \
  && echo "  OK no promote_ui_from_live_evidence (server authority)" \
  || { echo "  FAIL promote_ui_from_live_evidence still present"; exit 1; }
grep -q '"revision"' telemetry-data/network/battle_hud_publisher.py \
  && echo "  OK revision in battle snapshots" \
  || { echo "  FAIL revision missing in publisher"; exit 1; }
grep -q '"seq"' telemetry-data/engines/battlesystem/scoring.py \
  && echo "  OK pointsLog seq in scoring" \
  || { echo "  FAIL pointsLog seq missing"; exit 1; }
echo ""
echo "--- Interpretation ---"
echo "Redis state=active + version changing but HUD stuck → client delivery (SSE/poll) or apply_snapshot blocked"
echo "Redis key missing or state=pairing >60s → telemetry prep stuck or serverKey mismatch"
echo "version frozen >120s → HUD_BATTLE_TTL / publish stopped; check BATTLE_HUD_ENABLED"
echo "Post-battle plain 'Waiting for battle' → run ./scripts/verify-battle-idle-lobby.sh $STEAM_ID"
echo "Countdown ignores brake → check countdownHint + cancelReason=arming_aborted in Redis during arming"
