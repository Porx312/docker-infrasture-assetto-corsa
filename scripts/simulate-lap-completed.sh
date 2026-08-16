#!/usr/bin/env bash
# Simulate telemetry-data lap_completed → Redis ac:events → ac-data HUD SSE push.
### Steam ID: 76561199150078952 ### storm
### Steam ID: Stevie.fc 76561198135525145 ### 
### Steam ID: minty Steam ID: 76561199588591028 ### 
### Steam ID:  76561199230780195 ### porxz

# Use this to test HUD rank/rivals/PB updates without driving a real lap.
# No app code changes — publishes the same envelope as event_dispatcher.py.
#
# Prerequisites:
#   1. ac-data running on host (pgrep -af "tsx src/index")
#   2. HUD overlay connected to GET /hud/stream?steamId=... (or use --watch-sse)
#   3. Recommended: connected in-game on the target Akina downhill server so Convex
#      live_players matches; otherwise ingest or getHudSession may fail.
#
# ac-data only XACKs and pushes hud_version/hud_session after Convex ingest succeeds.
# If ingest fails, check ac-data.log for "convex batch ingest failed".
#
# What the HUD shows (Convex push → SSE):
#   - Convex lap ingest schedules POST /hud/worker/refresh-user (reason lap_pb | rival_pb)
#   - ac-data pushes hud_version + hud_session to connected SSE clients
#   - non-PB lap: last_lap_ms patched in Redis only; Convex does not notify
#   - overlay poll uses sections=battle when bundle exists (battle backup only)
#   - session/rank/rivals require SSE (or manual ./scripts/verify-push-sync-live.sh STEAM_ID lap_pb)
#
# Manual push while Convex lap webhook not deployed:
#   ./scripts/verify-push-sync-live.sh STEAM_ID lap_pb
#
# Rival observer test (Convex should push rival_pb after rival PB ingest):
#   Terminal 1 — observer SSE: curl -N 'http://127.0.0.1:3000/hud/stream?steamId=76561199230780195'
#   Terminal 2 — simulate rival PB: ./scripts/simulate-lap-completed.sh <rival_steamId> --lap-ms 270000
#   Observer should receive hud_session ~2-3s later with updated rival lap_ms
#   Verify: ./scripts/verify-hud-rival-fanout.sh <observerSteamId> <rivalSteamId> <lapMs>
#
# Non-PB test (repeat same time as cached PB — no SSE to observer):
#   Terminal 1 — observer SSE for prox
#   Terminal 2 — simulate minty repeat lap: ./scripts/simulate-lap-completed.sh <minty_steamId> --lap-ms 281000
#   (use --lap-ms equal to minty's cached best_lap_ms) — observer should NOT receive hud_session
#
# Verification:
#   tail -f ac-data.log | rg 'ingest|refresh-user|hud-user-status|hud-snapshot.*sections=battle'
#   ./scripts/verify-hud-lap-pipeline.sh STEAM_ID
#   docs/CONVEX_LAP_HUD_PUSH.md
#   ./scripts/verify-hud-overlay-contract.sh STEAM_ID
#   ./scripts/verify-convex-hud-session.sh STEAM_ID
#
# Usage:
#   ./scripts/simulate-lap-completed.sh [steamId] --lap-ms MS [options]
#
# Examples:
#   ./scripts/simulate-lap-completed.sh 76561199588591028 --lap-ms 272150
#   ./scripts/simulate-lap-completed.sh 76561199588591028 --lap-ms 300000 --dry-run
#   ./scripts/simulate-lap-completed.sh 76561199588591028 --lap-ms 270000 --watch-sse
#
# Options:
#   --lap-ms MS          Lap time in milliseconds (required unless --dry-run with --lap-ms)
#   --server-name NAME   Lobby display name (default: Porx)
#   --track ID           Track id (default: pk_akina)
#   --track-config CFG   Layout (default: akina_downhill)
#   --car MODEL          Car model id (default: ks_mazda_rx7_spirit_r)
#   --env dev|prod       Env file (default: dev → .env.local)
#   --dry-run            Print envelope JSON; do not XADD
#   --watch-sse          After publish, listen to /hud/stream for 15s
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STEAM_ID="${1:-76561199588591028}"
if [[ "$STEAM_ID" == --* ]]; then
  STEAM_ID="76561198135525145"
else
  shift || true
fi

LAP_MS=""
SERVER_NAME="Gunsai Testing"
TRACK="pk_akina"
TRACK_CONFIG="akina_downhill"
CAR_MODEL="ks_mazda_rx7_spirit_r"
ENV_MODE="dev"
DRY_RUN=0
WATCH_SSE=0

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lap-ms) LAP_MS="${2:?--lap-ms requires value}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:?}"; shift 2 ;;
    --track) TRACK="${2:?}"; shift 2 ;;
    --track-config) TRACK_CONFIG="${2:?}"; shift 2 ;;
    --car) CAR_MODEL="${2:?}"; shift 2 ;;
    --env) ENV_MODE="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --watch-sse) WATCH_SSE=1; shift ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown option: $1"
      usage 1
      ;;
  esac
done

if [[ -z "$LAP_MS" && "$DRY_RUN" -eq 0 ]]; then
  echo "ERROR: --lap-ms is required (lap time in milliseconds, e.g. 272150 for 4:32.150)"
  echo "Example: $0 $STEAM_ID --lap-ms 272150"
  exit 1
fi

if [[ -z "$LAP_MS" ]]; then
  LAP_MS="272150"
fi

case "$ENV_MODE" in
  prod|production) ENV_FILE=".env.production" ;;
  dev|development|"") ENV_FILE=".env.local" ;;
  *)
    echo "Unknown --env: $ENV_MODE (use dev or prod)"
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

STREAM_KEY="${REDIS_STREAM_KEY:-ac:events}"
INSTANCE_ID="${AC_INSTANCE_ID:-default}"
SCHEMA_VERSION="${REDIS_SCHEMA_VERSION:-1}"
MAXLEN="${REDIS_STREAM_MAXLEN:-200000}"
HUD_HOST="${HUD_HOST:-127.0.0.1:${PORT:-3000}}"

export SIM_STEAM_ID="$STEAM_ID"
export SIM_LAP_MS="$LAP_MS"
export SIM_SERVER_NAME="$SERVER_NAME"
export SIM_TRACK="$TRACK"
export SIM_TRACK_CONFIG="$TRACK_CONFIG"
export SIM_CAR_MODEL="$CAR_MODEL"
export SIM_INSTANCE_ID="$INSTANCE_ID"
export SIM_SCHEMA_VERSION="$SCHEMA_VERSION"
export SIM_STREAM_KEY="$STREAM_KEY"
export SIM_MAXLEN="$MAXLEN"
export DRY_RUN_FLAG="$DRY_RUN"
export REDIS_HOST="${REDIS_HOST:-}"
export REDIS_PORT="${REDIS_PORT:-}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"
export REDIS_SSL="${REDIS_SSL:-false}"

echo "=== simulate lap_completed ==="
echo "steamId=$STEAM_ID lapMs=$LAP_MS server=$SERVER_NAME track=$TRACK/$TRACK_CONFIG car=$CAR_MODEL"
echo "stream=$STREAM_KEY instance=$INSTANCE_ID env=$ENV_FILE"
echo ""

PUBLISH_OUTPUT="$(python3 <<'PY'
import json
import os
import subprocess
import sys
import time
import uuid

steam_id = os.environ["SIM_STEAM_ID"]
lap_ms = int(os.environ["SIM_LAP_MS"])
server_name = os.environ["SIM_SERVER_NAME"]
track = os.environ["SIM_TRACK"]
track_config = os.environ["SIM_TRACK_CONFIG"]
car_model = os.environ["SIM_CAR_MODEL"]
instance_id = os.environ["SIM_INSTANCE_ID"]
schema_version = os.environ["SIM_SCHEMA_VERSION"]
stream_key = os.environ["SIM_STREAM_KEY"]
maxlen = int(os.environ["SIM_MAXLEN"])
dry_run = os.environ.get("DRY_RUN_FLAG") == "1"

event_id = str(uuid.uuid4())
ts = int(time.time() * 1000)
data = {
    "steamId": steam_id,
    "carModel": car_model,
    "trackName": track,
    "trackConfig": track_config,
    "lapTime": lap_ms,
}
envelope = {
    "eventId": event_id,
    "schemaVersion": schema_version,
    "event": "lap_completed",
    "serverName": server_name,
    "instanceId": instance_id,
    "ts": ts,
    "data": data,
}
payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
fields = {
    "event": "lap_completed",
    "eventId": event_id,
    "schemaVersion": schema_version,
    "instanceId": instance_id,
    "serverName": server_name,
    "ts": str(ts),
    "payload": payload,
}

print(json.dumps(envelope, indent=2))
if dry_run:
    print("\n(dry-run — no XADD)")
    sys.exit(0)

cmd = ["redis-cli"]
redis_host = os.environ.get("REDIS_HOST", "").strip()
redis_port = os.environ.get("REDIS_PORT", "").strip()
redis_password = os.environ.get("REDIS_PASSWORD", "").strip()
redis_ssl = os.environ.get("REDIS_SSL", "").lower() == "true"

if redis_host:
    cmd.extend(["-h", redis_host])
if redis_port:
    cmd.extend(["-p", redis_port])
if redis_password:
    cmd.extend(["-a", redis_password])
if redis_ssl:
    cmd.append("--tls")

cmd.extend(["XADD", stream_key, "MAXLEN", "~", str(maxlen), "*"])
for key, value in fields.items():
    cmd.extend([key, value])

result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    print(result.stderr.strip() or result.stdout.strip(), file=sys.stderr)
    sys.exit(result.returncode)

redis_id = result.stdout.strip()
print(f"\nREDIS_ID={redis_id}")
PY
)"

echo "$PUBLISH_OUTPUT"
echo ""

if [[ "$DRY_RUN" -eq 1 ]]; then
  exit 0
fi

REDIS_ID="$(echo "$PUBLISH_OUTPUT" | sed -n 's/^REDIS_ID=//p' | tail -1)"
if [[ -z "$REDIS_ID" ]]; then
  echo "ERROR: Redis XADD failed (no stream id returned)"
  exit 1
fi

echo "Published to Redis: ${REDIS_ID}"
echo ""
echo "Expect HUD SSE in ~2–3s (debounce + delay). Watch:"
echo "  tail -f ac-data.log | rg 'hud-refresh|ingest'"
echo ""

if [[ "$WATCH_SSE" -eq 1 ]]; then
  ENC_STEAM="$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$STEAM_ID'''))")"
  SSE_URL="http://${HUD_HOST}/hud/stream?steamId=${ENC_STEAM}"
  echo "=== SSE watch (15s): $SSE_URL ==="
  timeout 15 curl -sN "$SSE_URL" 2>/dev/null | while IFS= read -r line; do
    if [[ "$line" == event:* ]]; then
      echo "$line"
    elif [[ "$line" == data:* ]]; then
      payload="${line#data: }"
      echo "$payload" | head -c 1200
      echo
    fi
  done || echo "(no SSE within 15s — is ac-data running and overlay reachable?)"
fi
