#!/usr/bin/env bash
# Simulate a full touge battle: Redis battle HUD snapshots + ac:events battle_finished.
#
# Default matchup: 76561199230780195 (Porx) vs 76561198706313764 (secondary)
# No app code changes — mirrors battle_hud_publisher.py + dispatch_battle_webhook().
#
# Prerequisites:
#   1. ac-data running on host (pgrep -af "tsx src/index")
#   2. HUD overlay on GET /hud/ws?steamId=... (or --watch-ws STEAM_ID)
#   3. Redis presence for the viewer (in-game join or ac:hud:presence:* seeded)
#
# What you should see:
#   - Multiple WSS `battle` frames (pairing → arming → armed → launching → active → finished)
#   - Toasts: overtake, recover, win (from lastEvent.label)
#   - After battle_finished ingest: hud_version + hud_session (~400ms, HUD_BATTLE_REFRESH_DELAY_MS)
#   - ~5s after finished: battle clear (ok:false reason no_battle)
#
# Verification:
#   tail -f ac-data.log | rg 'battle|hud-refresh|ingest'
#   ./scripts/verify-battle-pipeline.sh 76561199230780195
#   ./scripts/verify-battle-hud.sh 76561199230780195
#
# Usage:
#   ./scripts/simulate-battle-complete.sh [p1_steam] [p2_steam] [options]
#
# Examples:
#   ./scripts/simulate-battle-complete.sh
#   ./scripts/simulate-battle-complete.sh 76561199230780195 76561198135525145 --winner p2
#   ./scripts/simulate-battle-complete.sh --dry-run --fast
#   ./scripts/simulate-battle-complete.sh --watch-ws 76561199230780195 --fast
#   ./scripts/simulate-battle-complete.sh --skip-stream
#
# Options:
#   --winner p1|p2|draw     Winner (default: p2)
#   --server-name NAME      Lobby display name (default: HUD_BATTLE_SERVER_NAME or Gunsai Testing)
#   --track ID              Track id (default: pk_akina)
#   --track-config CFG      Layout (default: akina_downhill)
#   --car MODEL             Car model for both (default: ks_mazda_rx7_spirit_r)
#   --name-p1 / --name-p2   Display names (default: Porx / Stevie)
#   --car-name-p1 / --car-name-p2  Car display names
#   --avatar-p1 / --avatar-p2  Avatar URLs (default: from Redis session cache)
#   --tier-p1 / --tier-p2 / --elo-p1 / --elo-p2  Profile stats
#   --no-seed-profiles      Do not write ac:hud:session cache before battle
#   --step-ms MS            Pause between HUD phases (default: 800)
#   --fast                  Shorter pauses (step-ms 200)
#   --env dev|prod          Env file (default: dev → .env.local)
#   --dry-run               Print phase JSON; no Redis writes
#   --skip-stream           HUD phases only; no XADD to ac:events
#   --watch-ws STEAM_ID    listen on /hud/ws during simulation (--watch-sse alias)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLAYER1_STEAM="76561199230780195"
PLAYER2_STEAM="76561198706313764"

if [[ $# -gt 0 && "$1" != --* ]]; then
  PLAYER1_STEAM="$1"
  shift
fi
if [[ $# -gt 0 && "$1" != --* ]]; then
  PLAYER2_STEAM="$1"
  shift
fi

WINNER="p2"
SERVER_NAME="${HUD_BATTLE_SERVER_NAME:-Gunsai Testing}"
TRACK="pk_akina"
TRACK_CONFIG="akina_downhill"
CAR_MODEL="ks_mazda_rx7_spirit_r"
NAME_P1="Porx"
NAME_P2="Stevie"
CAR_NAME_P1="Mazda RX-7 Spirit R"
CAR_NAME_P2="Mazda RX-7 Spirit R"
AVATAR_P1=""
AVATAR_P2=""
TIER_P1=""
TIER_P2=""
ELO_P1=""
ELO_P2=""
SEED_PROFILES=1
STEP_MS="800"
ENV_MODE="dev"
DRY_RUN=0
SKIP_STREAM=0
FAST=0
WATCH_WS_STEAM=""

usage() {
  sed -n '2,45p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --winner) WINNER="${2:?--winner requires p1|p2|draw}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:?}"; shift 2 ;;
    --track) TRACK="${2:?}"; shift 2 ;;
    --track-config) TRACK_CONFIG="${2:?}"; shift 2 ;;
    --car) CAR_MODEL="${2:?}"; shift 2 ;;
    --name-p1) NAME_P1="${2:?}"; shift 2 ;;
    --name-p2) NAME_P2="${2:?}"; shift 2 ;;
    --car-name-p1) CAR_NAME_P1="${2:?}"; shift 2 ;;
    --car-name-p2) CAR_NAME_P2="${2:?}"; shift 2 ;;
    --avatar-p1) AVATAR_P1="${2:?}"; shift 2 ;;
    --avatar-p2) AVATAR_P2="${2:?}"; shift 2 ;;
    --tier-p1) TIER_P1="${2:?}"; shift 2 ;;
    --tier-p2) TIER_P2="${2:?}"; shift 2 ;;
    --elo-p1) ELO_P1="${2:?}"; shift 2 ;;
    --elo-p2) ELO_P2="${2:?}"; shift 2 ;;
    --no-seed-profiles) SEED_PROFILES=0; shift ;;
    --step-ms) STEP_MS="${2:?}"; shift 2 ;;
    --fast) FAST=1; shift ;;
    --env) ENV_MODE="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-stream) SKIP_STREAM=1; shift ;;
    --watch-ws|--watch-sse) WATCH_WS_STEAM="${2:?--watch-ws requires steamId}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown option: $1"
      usage 1
      ;;
  esac
done

if [[ "$FAST" -eq 1 ]]; then
  STEP_MS="200"
fi

case "$WINNER" in
  p1|p2|draw) ;;
  *)
    echo "ERROR: --winner must be p1, p2, or draw"
    exit 1
    ;;
esac

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
BATTLE_TTL="${HUD_BATTLE_TTL_SEC:-120}"
VER_TTL="${HUD_VER_TTL_SEC:-3600}"

export SIM_P1="$PLAYER1_STEAM"
export SIM_P2="$PLAYER2_STEAM"
export SIM_WINNER="$WINNER"
export SIM_SERVER_NAME="$SERVER_NAME"
export SIM_TRACK="$TRACK"
export SIM_TRACK_CONFIG="$TRACK_CONFIG"
export SIM_CAR="$CAR_MODEL"
export SIM_NAME_P1="$NAME_P1"
export SIM_NAME_P2="$NAME_P2"
export SIM_CAR_NAME_P1="$CAR_NAME_P1"
export SIM_CAR_NAME_P2="$CAR_NAME_P2"
export SIM_AVATAR_P1="$AVATAR_P1"
export SIM_AVATAR_P2="$AVATAR_P2"
export SIM_TIER_P1="$TIER_P1"
export SIM_TIER_P2="$TIER_P2"
export SIM_ELO_P1="$ELO_P1"
export SIM_ELO_P2="$ELO_P2"
export SIM_SEED_PROFILES="$SEED_PROFILES"
export SIM_STEP_MS="$STEP_MS"
export SIM_INSTANCE_ID="$INSTANCE_ID"
export SIM_SCHEMA_VERSION="$SCHEMA_VERSION"
export SIM_STREAM_KEY="$STREAM_KEY"
export SIM_MAXLEN="$MAXLEN"
export SIM_BATTLE_TTL="$BATTLE_TTL"
export SIM_VER_TTL="$VER_TTL"
export DRY_RUN_FLAG="$DRY_RUN"
export SKIP_STREAM_FLAG="$SKIP_STREAM"
export REDIS_HOST="${REDIS_HOST:-}"
export REDIS_PORT="${REDIS_PORT:-}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"
export REDIS_SSL="${REDIS_SSL:-false}"

echo "=== simulate battle (full) ==="
echo "p1=$PLAYER1_STEAM ($NAME_P1) vs p2=$PLAYER2_STEAM ($NAME_P2) winner=$WINNER"
echo "server=$SERVER_NAME track=$TRACK/$TRACK_CONFIG car=$CAR_MODEL stepMs=$STEP_MS"
echo "instance=$INSTANCE_ID env=$ENV_FILE dryRun=$DRY_RUN skipStream=$SKIP_STREAM"
echo ""

WATCH_PID=""
if [[ -n "$WATCH_WS_STEAM" && "$DRY_RUN" -eq 0 ]]; then
  echo "=== WSS watch (background): steamId=$WATCH_WS_STEAM ==="
  (
    "$ROOT/scripts/verify-hud-ws-contract.sh" "$WATCH_WS_STEAM" "${HUD_API_KEY:-}" 2>&1 | while IFS= read -r line; do
      echo "[wss] $line"
    done
  ) &
  WATCH_PID=$!
fi

python3 <<'PY'
import json
import os
import re
import subprocess
import sys
import time
import uuid

P1 = os.environ["SIM_P1"]
P2 = os.environ["SIM_P2"]
WINNER = os.environ["SIM_WINNER"]
SERVER_NAME = os.environ["SIM_SERVER_NAME"]
TRACK = os.environ["SIM_TRACK"]
TRACK_CONFIG = os.environ["SIM_TRACK_CONFIG"]
CAR = os.environ["SIM_CAR"]
NAME_P1 = os.environ["SIM_NAME_P1"]
NAME_P2 = os.environ["SIM_NAME_P2"]
CAR_NAME_P1 = os.environ["SIM_CAR_NAME_P1"]
CAR_NAME_P2 = os.environ["SIM_CAR_NAME_P2"]
AVATAR_P1 = os.environ.get("SIM_AVATAR_P1", "").strip()
AVATAR_P2 = os.environ.get("SIM_AVATAR_P2", "").strip()
TIER_P1 = os.environ.get("SIM_TIER_P1", "").strip()
TIER_P2 = os.environ.get("SIM_TIER_P2", "").strip()
ELO_P1 = os.environ.get("SIM_ELO_P1", "").strip()
ELO_P2 = os.environ.get("SIM_ELO_P2", "").strip()
SEED_PROFILES = os.environ.get("SIM_SEED_PROFILES", "1") == "1"
STEP_MS = int(os.environ["SIM_STEP_MS"])
INSTANCE_ID = os.environ["SIM_INSTANCE_ID"]
SCHEMA_VERSION = os.environ["SIM_SCHEMA_VERSION"]
STREAM_KEY = os.environ["SIM_STREAM_KEY"]
MAXLEN = int(os.environ["SIM_MAXLEN"])
BATTLE_TTL = int(os.environ["SIM_BATTLE_TTL"])
VER_TTL = int(os.environ["SIM_VER_TTL"])
DRY_RUN = os.environ.get("DRY_RUN_FLAG") == "1"
SKIP_STREAM = os.environ.get("SKIP_STREAM_FLAG") == "1"
DISAPPEAR_GAP_M = 250

BATTLE_ID = f"battle-sim-{uuid.uuid4().hex[:12]}"
POINTS_LOG: list[dict] = []
VERSION_COUNTER = 0
P1_PROFILE: dict = {}
P2_PROFILE: dict = {}


def next_version() -> str:
    global VERSION_COUNTER
    VERSION_COUNTER += 1
    return str(int(time.time() * 1000) + VERSION_COUNTER)


def normalize_key_part(value: str) -> str:
    return re.sub(r"\s+", "_", value.strip().lower())


def server_key() -> str:
    return f"{normalize_key_part(INSTANCE_ID)}_{normalize_key_part(SERVER_NAME)}"


def redis_cmd() -> list[str]:
    cmd = ["redis-cli"]
    host = os.environ.get("REDIS_HOST", "").strip()
    port = os.environ.get("REDIS_PORT", "").strip()
    password = os.environ.get("REDIS_PASSWORD", "").strip()
    ssl = os.environ.get("REDIS_SSL", "").lower() == "true"
    if host:
        cmd.extend(["-h", host])
    if port:
        cmd.extend(["-p", port])
    if password:
        cmd.extend(["-a", password])
    if ssl:
        cmd.append("--tls")
    return cmd


def run_redis(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(redis_cmd() + list(args), capture_output=True, text=True)


def read_cached_hud_profile(steam_id: str) -> dict | None:
    if DRY_RUN:
        return None
    result = run_redis("GET", f"ac:hud:session:{steam_id}")
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        parsed = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return None
    if not parsed.get("ok") or not parsed.get("profile"):
        return None
    return parsed["profile"]


def int_or(value: str, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def build_player_profile(
    steam_id: str,
    default_name: str,
    default_car_name: str,
    avatar_override: str,
    tier_override: str,
    elo_override: str,
) -> dict:
    cached = read_cached_hud_profile(steam_id) or {}
    profile = {
        "steamId": steam_id,
        "name": cached.get("name") or default_name,
        "tier": int_or(tier_override, int(cached.get("tier") or 5)),
        "elo": int_or(elo_override, int(cached.get("elo") or 1500)),
        "car_id": cached.get("car_id") or CAR,
        "car_name": cached.get("car_name") or default_car_name,
        "avatar_url": avatar_override or cached.get("avatar_url") or "",
    }
    return profile


def seed_hud_session_cache(steam_id: str, profile: dict) -> None:
    if DRY_RUN or not SEED_PROFILES:
        return
    session = {
        "ok": True,
        "version": f"sim:{BATTLE_ID}",
        "context": {
            "server_id": "sim",
            "server_name": SERVER_NAME,
            "track_id": TRACK,
            "track_name": TRACK,
            "layout_id": TRACK_CONFIG,
            "layout_name": TRACK_CONFIG,
            "car_id": profile["car_id"],
            "car_name": profile["car_name"],
            "player_steam_id": steam_id,
        },
        "profile": {
            "name": profile["name"],
            "rank": 10,
            "tier": profile["tier"],
            "best_lap_ms": 280_000,
            "car_name": profile["car_name"],
            "car_id": profile["car_id"],
            "steam_id": steam_id,
            "elo": profile["elo"],
            "rivals": {"above": None, "below": None},
            **({"avatar_url": profile["avatar_url"]} if profile.get("avatar_url") else {}),
        },
    }
    payload = json.dumps(session, separators=(",", ":"), ensure_ascii=False)
    ttl = max(BATTLE_TTL, 300)
    run_redis("SET", f"ac:hud:session:{steam_id}", payload, "EX", str(ttl))
    player = {
        "ok": True,
        "profile": session["profile"],
    }
    run_redis(
        "SET",
        f"ac:hud:player:{steam_id}",
        json.dumps(player, separators=(",", ":"), ensure_ascii=False),
        "EX",
        str(ttl),
    )


def seed_hud_presence(steam_id: str) -> None:
    """Seed ac:hud:presence so /hud/snapshot and SSE can resolve serverName."""
    if DRY_RUN:
        return
    record = {
        "serverName": SERVER_NAME,
        "track": TRACK,
        "trackConfig": TRACK_CONFIG,
        "carModel": CAR,
        "updatedAt": int(time.time() * 1000),
    }
    payload = json.dumps(record, separators=(",", ":"), ensure_ascii=False)
    ttl = max(BATTLE_TTL, 600)
    run_redis("SET", f"ac:hud:presence:{steam_id}", payload, "EX", str(ttl))


def init_profiles() -> None:
    global P1_PROFILE, P2_PROFILE
    P1_PROFILE = build_player_profile(P1, NAME_P1, CAR_NAME_P1, AVATAR_P1, TIER_P1, ELO_P1)
    P2_PROFILE = build_player_profile(P2, NAME_P2, CAR_NAME_P2, AVATAR_P2, TIER_P2, ELO_P2)
    seed_hud_session_cache(P1, P1_PROFILE)
    seed_hud_session_cache(P2, P2_PROFILE)
    seed_hud_presence(P1)
    seed_hud_presence(P2)
    print(
        "profiles:",
        f"p1={P1_PROFILE['name']} tier={P1_PROFILE['tier']} elo={P1_PROFILE['elo']}",
        f"avatar={'yes' if P1_PROFILE.get('avatar_url') else 'no'}",
    )
    print(
        "         ",
        f"p2={P2_PROFILE['name']} tier={P2_PROFILE['tier']} elo={P2_PROFILE['elo']}",
        f"avatar={'yes' if P2_PROFILE.get('avatar_url') else 'no'}",
    )
    print("")


def make_event(reason: str, label: str, scorer: str | None = None) -> dict:
    event = {
        "reason": reason,
        "label": label,
        "ts": int(time.time() * 1000),
    }
    if scorer:
        event["scorerSteamId"] = scorer
    return event


def add_point(scorer: str, reason: str, label: str) -> None:
    entry = {
        "scorer": scorer,
        "reason": reason,
        "ts": int(time.time() * 1000),
        "label": label,
    }
    POINTS_LOG.append(entry)


def player_payload(profile: dict, score: int, role: str | None = None) -> dict:
    payload = {
        "steamId": profile["steamId"],
        "name": profile["name"],
        "tier": profile["tier"],
        "elo": profile["elo"],
        "car_id": profile["car_id"],
        "car_name": profile["car_name"],
        "score": score,
    }
    if profile.get("avatar_url"):
        payload["avatar_url"] = profile["avatar_url"]
    if role:
        payload["role"] = role
    return payload


def build_snapshot(
    state: str,
    *,
    p1_score: int = 0,
    p2_score: int = 0,
    p1_role: str | None = None,
    p2_role: str | None = None,
    arming_countdown: int | None = None,
    gap3d_m: float | None = None,
    last_event: dict | None = None,
    status: str | None = None,
    winner_steam_id: str | None = None,
    end_label: str | None = None,
) -> dict:
    version = next_version()
    snapshot: dict = {
        "ok": True,
        "version": version,
        "battleId": BATTLE_ID,
        "state": state,
        "serverName": SERVER_NAME,
        "track": TRACK,
        "trackConfig": TRACK_CONFIG,
        "player1": player_payload(P1_PROFILE, p1_score, p1_role),
        "player2": player_payload(P2_PROFILE, p2_score, p2_role),
        "pointsLog": list(POINTS_LOG),
        "disappearGapM": DISAPPEAR_GAP_M,
    }
    if arming_countdown is not None:
        snapshot["armingCountdownSec"] = arming_countdown
    if gap3d_m is not None:
        snapshot["gap3dM"] = gap3d_m
    if last_event:
        snapshot["lastEvent"] = last_event
    if status:
        snapshot["status"] = status
    if winner_steam_id:
        snapshot["winnerSteamId"] = winner_steam_id
    if end_label:
        snapshot["endLabel"] = end_label
    elif state == "finished" and WINNER == "draw":
        snapshot["endLabel"] = "draw"
    elif state == "finished" and winner_steam_id:
        snapshot["endLabel"] = "win"
    if state in ("pairing", "arming", "armed", "launching", "active"):
        snapshot.setdefault("status", "active")
    return snapshot


def publish_snapshot(snapshot: dict) -> None:
    sk = server_key()
    payload = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False)
    version = snapshot["version"]
    cache_key_p1 = f"{sk}:{P1}"
    cache_key_p2 = f"{sk}:{P2}"

    if DRY_RUN:
        label = snapshot["state"]
        countdown = snapshot.get("armingCountdownSec")
        if countdown is not None:
            label = f"arming ({countdown})"
        print(f"\n--- phase: {label} ---")
        print(json.dumps(snapshot, indent=2))
        return

    for steam_id, cache_key in ((P1, cache_key_p1), (P2, cache_key_p2)):
        battle_key = f"ac:hud:battle:{cache_key}"
        ver_key = f"ac:hud:ver:battle:{cache_key}"
        scope_key = f"battle:{cache_key}"

        set_result = run_redis("SET", battle_key, payload, "EX", str(BATTLE_TTL))
        if set_result.returncode != 0:
            print(set_result.stderr.strip() or set_result.stdout.strip(), file=sys.stderr)
            sys.exit(set_result.returncode)

        ver_result = run_redis("SET", ver_key, version, "EX", str(VER_TTL))
        if ver_result.returncode != 0:
            print(ver_result.stderr.strip() or ver_result.stdout.strip(), file=sys.stderr)
            sys.exit(ver_result.returncode)

        pub_payload = json.dumps(
            {"scopeKey": scope_key, "version": version, "ts": int(time.time() * 1000)},
            separators=(",", ":"),
        )
        pub_result = run_redis("PUBLISH", "ac:hud:updates", pub_payload)
        if pub_result.returncode != 0:
            print(pub_result.stderr.strip() or pub_result.stdout.strip(), file=sys.stderr)
            sys.exit(pub_result.returncode)

    print(
        f"  published phase={snapshot['state']}"
        + (f" countdown={snapshot.get('armingCountdownSec')}" if snapshot.get("armingCountdownSec") is not None else "")
        + f" score={snapshot['player1']['score']}-{snapshot['player2']['score']}"
        + f" version={version}"
    )


def sleep_step() -> None:
    if DRY_RUN or STEP_MS <= 0:
        return
    time.sleep(STEP_MS / 1000.0)


def final_scores() -> tuple[int, int, str | None]:
    if WINNER == "p1":
        return 3, 2, P1
    if WINNER == "p2":
        return 2, 3, P2
    return 2, 2, None


def build_phases() -> list[dict]:
    phases: list[dict] = []

    # VS screen: both players visible with full profile from first frame
    phases.append(build_snapshot("pairing", p1_score=0, p2_score=0, gap3d_m=8.0))

    for countdown in (5, 4, 3, 2, 1):
        phases.append(
            build_snapshot(
                "arming",
                p1_score=0,
                p2_score=0,
                arming_countdown=countdown,
                gap3d_m=8.0,
            )
        )

    phases.append(build_snapshot("armed", p1_score=0, p2_score=0, gap3d_m=6.5))

    phases.append(
        build_snapshot(
            "launching",
            p1_score=0,
            p2_score=0,
            gap3d_m=22.0,
        )
    )

    overtake_event = make_event("overtake", "overtake", P2)
    add_point(P2, "overtake", "overtake")
    phases.append(
        build_snapshot(
            "active",
            p1_score=0,
            p2_score=1,
            p1_role="chase",
            p2_role="lead",
            gap3d_m=14.5,
            last_event=overtake_event,
        )
    )

    recover_event = make_event("position_recovery", "recover", P1)
    add_point(P1, "position_recovery", "recover")
    phases.append(
        build_snapshot(
            "active",
            p1_score=1,
            p2_score=1,
            p1_role="lead",
            p2_role="chase",
            gap3d_m=11.0,
            last_event=recover_event,
        )
    )

    overtake2 = make_event("overtake", "overtake", P2)
    add_point(P2, "overtake", "overtake")
    phases.append(
        build_snapshot(
            "active",
            p1_score=1,
            p2_score=2,
            p1_role="chase",
            p2_role="lead",
            gap3d_m=9.5,
            last_event=overtake2,
        )
    )

    p1_final, p2_final, winner_id = final_scores()
    if WINNER == "draw":
        draw_event = make_event("draw", "draw")
        phases.append(
            build_snapshot(
                "finished",
                p1_score=p1_final,
                p2_score=p2_final,
                status="draw",
                end_label="draw",
                last_event=draw_event,
            )
        )
    else:
        win_event = make_event("finish_outrun", "win", winner_id)
        add_point(winner_id, "finish_outrun", "win")
        lead = "lead" if winner_id == P1 else "chase"
        chase = "chase" if winner_id == P1 else "lead"
        p1_role = lead if winner_id == P1 else chase
        p2_role = chase if winner_id == P1 else lead
        phases.append(
            build_snapshot(
                "finished",
                p1_score=p1_final,
                p2_score=p2_final,
                p1_role=p1_role,
                p2_role=p2_role,
                gap3d_m=6.0,
                status="finished",
                winner_steam_id=winner_id,
                end_label="win",
                last_event=win_event,
            )
        )

    return phases


def xadd_event(event_type: str, data: dict) -> str:
    event_id = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    envelope = {
        "eventId": event_id,
        "schemaVersion": SCHEMA_VERSION,
        "event": event_type,
        "serverName": SERVER_NAME,
        "instanceId": INSTANCE_ID,
        "ts": ts,
        "data": data,
    }
    payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
    fields = {
        "event": event_type,
        "eventId": event_id,
        "schemaVersion": SCHEMA_VERSION,
        "instanceId": INSTANCE_ID,
        "serverName": SERVER_NAME,
        "ts": str(ts),
        "payload": payload,
    }
    cmd = redis_cmd()
    cmd.extend(["XADD", STREAM_KEY, "MAXLEN", "~", str(MAXLEN), "*"])
    for key, value in fields.items():
        cmd.extend([key, value])
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr.strip() or result.stdout.strip(), file=sys.stderr)
        sys.exit(result.returncode)
    return result.stdout.strip()


def publish_stream_events(final_snapshot: dict) -> None:
    p1_score = final_snapshot["player1"]["score"]
    p2_score = final_snapshot["player2"]["score"]
    data = {
        "battleId": BATTLE_ID,
        "player1SteamId": P1,
        "player2SteamId": P2,
        "player1Score": p1_score,
        "player2Score": p2_score,
        "player1Car": CAR,
        "player2Car": CAR,
        "player1Name": P1_PROFILE["name"],
        "player2Name": P2_PROFILE["name"],
        "pointsLog": POINTS_LOG,
        "status": final_snapshot.get("status", "finished"),
        "serverName": SERVER_NAME,
        "track": TRACK,
        "trackConfig": TRACK_CONFIG,
    }
    winner = final_snapshot.get("winnerSteamId")
    if winner:
        data["winnerSteamId"] = winner

    if DRY_RUN:
        print("\n--- stream: battle_update ---")
        print(json.dumps(data, indent=2))
        if data["status"] in ("finished", "draw"):
            print("\n--- stream: battle_finished ---")
            print(json.dumps(data, indent=2))
        return

    rid1 = xadd_event("battle_update", data)
    print(f"  XADD battle_update id={rid1}")
    if data["status"] in ("finished", "draw"):
        rid2 = xadd_event("battle_finished", data)
        print(f"  XADD battle_finished id={rid2}")


init_profiles()
phases = build_phases()
print(f"battleId={BATTLE_ID} phases={len(phases)} serverKey={server_key()}")
print("")

for i, phase in enumerate(phases):
    publish_snapshot(phase)
    if i < len(phases) - 1:
        sleep_step()

final = phases[-1]
if not SKIP_STREAM:
    print("")
    print("Publishing Convex stream events...")
    publish_stream_events(final)
elif DRY_RUN:
    print("\n(skip-stream: no ac:events XADD)")

if DRY_RUN:
    print("\n(dry-run complete — no Redis writes)")
PY

echo ""
echo "Battle simulation complete."
echo ""
echo "Watch ac-data:"
echo "  tail -f ac-data.log | rg 'battle|hud-refresh|ingest'"
echo ""
echo "Verify:"
echo "  ./scripts/verify-battle-pipeline.sh $PLAYER1_STEAM"
echo "  ./scripts/verify-battle-hud.sh $PLAYER1_STEAM"
echo ""

if [[ -n "$WATCH_PID" ]]; then
  sleep 8
  kill "$WATCH_PID" 2>/dev/null || true
  wait "$WATCH_PID" 2>/dev/null || true
fi
