"""Publish live battle HUD snapshots to Redis for ac-data SSE /hud/battle/stream."""

from __future__ import annotations

import json
import re
import threading
import time
from typing import Any

from core import settings
from core.cm_name import display_server_name
from core.logging_config import get_logger
from core.redis_client import get_redis_client
from engines.battlesystem.config import DISAPPEAR_GAP_METERS
from engines.battlesystem.rules.proximity import distance_3d

log = get_logger("battle_hud_publisher")

HUD_BATTLE_PREFIX = "ac:hud:battle:"
HUD_VER_BATTLE_PREFIX = "ac:hud:ver:battle:"
HUD_UPDATES_CHANNEL = "ac:hud:updates"

_DEBOUNCE_LOCK = threading.Lock()
_CLEAR_TIMER_LOCK = threading.Lock()
_LAST_PUBLISH_BY_PAIR: dict[tuple[str, str], float] = {}
_PENDING_CLEAR_TIMERS: dict[tuple[str, str], threading.Timer] = {}


def normalize_hud_key_part(value: str) -> str:
    """Match ac-data normalizeHudKeyPart: trim, lower, spaces -> underscores."""
    return re.sub(r"\s+", "_", value.strip().lower())


def format_point_label(reason: str) -> str:
    """One-word HUD toast label (overlay space is limited)."""
    labels = {
        "draw": "draw",
        "overtake": "overtake",
        "position_recovery": "recover",
        "outrun": "outrun",
        "dnf_lead_stalled": "stopped",
        "dnf_chase_stalled": "stopped",
        "finish_outrun": "finish",
    }
    return labels.get(reason, reason)


def format_cancel_label(reason: str | None) -> str:
    """One-word HUD cancel/end toast (chat uses engines/battlesystem/chat.py)."""
    if reason == "opponent_stalled":
        return "stopped"
    if reason in ("arming_aborted", "prestart_gap"):
        return "cancel"
    if reason in (
        "gap_disappeared",
        "opponent_disconnected",
        "opponent_inactive",
        "pair stale",
        "separated_idle",
        "pre_active_timeout",
        "not enough players",
        "pair missing",
    ):
        return "cancel"
    if reason:
        return "cancel"
    return "cancel"


def format_abandon_win_label(manager, winner_guid: str, reason: str) -> str:
    return "win"


def format_finish_session_label(
    manager,
    finish_gap_m: float,
    *,
    is_draw: bool,
    winner_guid: str | None,
) -> str:
    if is_draw:
        return "draw"
    return "win"


def make_hud_event(
    reason: str,
    label: str,
    *,
    scorer_steam_id: str | None = None,
    ts: int | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "reason": reason,
        "label": label,
        "ts": ts if ts is not None else int(time.time() * 1000),
    }
    if scorer_steam_id:
        event["scorerSteamId"] = scorer_steam_id
    return event


def _pair_key(manager) -> tuple[str, str] | None:
    if not manager.battle:
        return None
    g1 = manager.battle.car1_guid
    g2 = manager.battle.car2_guid
    return tuple(sorted((g1, g2)))


def _resolve_hud_state(manager, hud_state: str | None) -> str:
    if hud_state:
        return hud_state
    state = manager.state
    if state == "IDLE":
        if getattr(manager, "arm_proximity_since", 0.0) > 0.0:
            return "arming"
        return "pairing"
    if state == "ARMED":
        return "armed"
    if state == "LAUNCHING":
        return "launching"
    if state == "ACTIVE":
        return "active"
    if state == "FINISHED":
        return "finished"
    return "none"


def _arming_countdown_sec(manager) -> int | None:
    if _resolve_hud_state(manager, None) != "arming":
        return None
    from engines.battlesystem.config import ARM_SUSTAINED_PROXIMITY_SEC
    import math

    now = time.time()
    elapsed = now - manager.arm_proximity_since
    remaining = ARM_SUSTAINED_PROXIMITY_SEC - elapsed
    if remaining <= 0:
        return 0
    return max(1, int(math.ceil(remaining)))


def _driver_field(server_state, guid: str, attr: str) -> str:
    driver = getattr(server_state, "guid_to_driver", {}).get(guid)
    return str(getattr(driver, attr, "") or "") if driver else ""


def _player_payload(manager, server_state, guid: str, score: int) -> dict[str, Any]:
    role = None
    battle = manager.battle
    if battle and manager.state == "ACTIVE":
        if guid == battle.lead_guid:
            role = "lead"
        elif guid == battle.chase_guid:
            role = "chase"
    name = manager._display_name(guid)
    car = _driver_field(server_state, guid, "model") or manager.player_names.get(guid, "")
    return {
        "steamId": guid,
        "name": name,
        "car_id": car,
        "score": score,
        **({"role": role} if role else {}),
    }


def _gap3d_m(manager) -> float | None:
    """Current 3D separation between battle participants (meters)."""
    battle = manager.battle
    if not battle:
        return None
    c1 = manager.cars.get(battle.car1_guid)
    c2 = manager.cars.get(battle.car2_guid)
    if not c1 or not c2:
        return None
    return round(distance_3d(c1.pos, c2.pos), 1)


def _build_points_log(manager) -> list[dict[str, Any]]:
    if not manager.battle:
        return []
    entries = []
    for entry in manager.battle.points_log:
        reason = entry.get("reason", "")
        entries.append(
            {
                "scorer": entry.get("scorer"),
                "reason": reason,
                "ts": entry.get("ts", 0),
                "label": format_point_label(reason),
            }
        )
    return entries


def build_battle_snapshot(
    server_state,
    manager,
    *,
    hud_state: str | None = None,
    last_event: dict[str, Any] | None = None,
    cancel_reason: str | None = None,
    end_reason: str | None = None,
    end_label: str | None = None,
    finish_gap_m: float | None = None,
    position_fallback: bool | None = None,
) -> dict[str, Any]:
    battle = manager.battle
    if not battle:
        return {"ok": False, "reason": "no_battle"}

    resolved_state = _resolve_hud_state(manager, hud_state)
    server_name = display_server_name(server_state)
    track = getattr(server_state, "track", "") or ""
    track_config = getattr(server_state, "config", "") or ""

    snapshot: dict[str, Any] = {
        "ok": True,
        "battleId": manager.battle_id,
        "state": resolved_state,
        "serverName": server_name,
        "track": track,
        "trackConfig": track_config,
        "player1": _player_payload(manager, server_state, battle.car1_guid, battle.car1_score),
        "player2": _player_payload(manager, server_state, battle.car2_guid, battle.car2_score),
        "pointsLog": _build_points_log(manager),
        "disappearGapM": DISAPPEAR_GAP_METERS,
    }

    gap3d_m = _gap3d_m(manager)
    if gap3d_m is not None:
        snapshot["gap3dM"] = gap3d_m

    countdown = _arming_countdown_sec(manager)
    if countdown is not None:
        snapshot["armingCountdownSec"] = countdown

    if cancel_reason:
        snapshot["cancelReason"] = cancel_reason
    if end_reason:
        snapshot["endReason"] = end_reason
    if end_label:
        snapshot["endLabel"] = end_label
    if finish_gap_m is not None:
        snapshot["finishGapM"] = round(float(finish_gap_m), 1)
    if position_fallback:
        snapshot["positionFallback"] = True

    if last_event:
        snapshot["lastEvent"] = last_event

    if battle.winner:
        snapshot["winnerSteamId"] = battle.winner
        snapshot["status"] = "finished"
    elif resolved_state == "finished":
        if battle.car1_score == battle.car2_score:
            snapshot["status"] = "draw"
        else:
            snapshot["status"] = "finished"
            if battle.winner:
                snapshot["winnerSteamId"] = battle.winner
    elif resolved_state == "cancelled":
        snapshot["status"] = "cancelled"
    elif resolved_state in ("pairing", "arming", "armed", "launching", "active"):
        snapshot["status"] = "active"

    return snapshot


def _battle_cache_key(server_key: str, steam_id: str) -> str:
    return f"{HUD_BATTLE_PREFIX}{server_key}:{steam_id}"


def _battle_version_key(server_key: str, steam_id: str) -> str:
    return f"{HUD_VER_BATTLE_PREFIX}{server_key}:{steam_id}"


def _scope_key(server_key: str, steam_id: str) -> str:
    return f"battle:{server_key}:{steam_id}"


def _should_debounce(pair_key: tuple[str, str], force: bool) -> bool:
    if force:
        return False
    debounce_ms = settings.HUD_BATTLE_DEBOUNCE_MS
    if debounce_ms <= 0:
        return False
    now = time.time()
    with _DEBOUNCE_LOCK:
        last = _LAST_PUBLISH_BY_PAIR.get(pair_key, 0.0)
        if (now - last) * 1000 < debounce_ms:
            return True
        _LAST_PUBLISH_BY_PAIR[pair_key] = now
    return False


def publish_battle_hud(
    server_state,
    manager,
    *,
    hud_state: str | None = None,
    last_event: dict[str, Any] | None = None,
    cancel_reason: str | None = None,
    end_reason: str | None = None,
    end_label: str | None = None,
    finish_gap_m: float | None = None,
    position_fallback: bool | None = None,
    force: bool = False,
) -> None:
    if not settings.BATTLE_HUD_ENABLED or not settings.REDIS_HOST:
        return
    if not manager.battle:
        return

    pair_key = _pair_key(manager)
    if pair_key and _should_debounce(pair_key, force):
        return

    snapshot = build_battle_snapshot(
        server_state,
        manager,
        hud_state=hud_state,
        last_event=last_event,
        cancel_reason=cancel_reason,
        end_reason=end_reason,
        end_label=end_label,
        finish_gap_m=finish_gap_m,
        position_fallback=position_fallback,
    )
    if not snapshot.get("ok"):
        return

    version = str(int(time.time() * 1000))
    snapshot["version"] = version

    server_key = normalize_hud_key_part(display_server_name(server_state))
    g1 = manager.battle.car1_guid
    g2 = manager.battle.car2_guid
    ttl = max(
        settings.HUD_BATTLE_TTL_SEC,
        settings.HUD_BATTLE_CLEAR_DELAY_SEC + 2,
    )
    ver_ttl = settings.HUD_VER_TTL_SEC

    try:
        redis = get_redis_client()
        payload = json.dumps(snapshot, separators=(",", ":"))
        for steam_id in (g1, g2):
            redis.set(_battle_cache_key(server_key, steam_id), payload, ex=ttl)
            redis.set(_battle_version_key(server_key, steam_id), version, ex=ver_ttl)
            redis.publish(
                HUD_UPDATES_CHANNEL,
                json.dumps(
                    {
                        "scopeKey": _scope_key(server_key, steam_id),
                        "version": version,
                        "ts": int(time.time() * 1000),
                    },
                    separators=(",", ":"),
                ),
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("battle HUD publish failed: %s", exc)


def clear_battle_hud(server_state, steam_ids: list[str]) -> None:
    if not settings.BATTLE_HUD_ENABLED or not settings.REDIS_HOST:
        return
    if not steam_ids:
        return

    server_key = normalize_hud_key_part(display_server_name(server_state))
    try:
        redis = get_redis_client()
        for steam_id in steam_ids:
            redis.delete(_battle_cache_key(server_key, steam_id))
            redis.delete(_battle_version_key(server_key, steam_id))
        with _DEBOUNCE_LOCK:
            for key in list(_LAST_PUBLISH_BY_PAIR):
                if key[0] in steam_ids or key[1] in steam_ids:
                    _LAST_PUBLISH_BY_PAIR.pop(key, None)
        with _CLEAR_TIMER_LOCK:
            for steam_id in steam_ids:
                _PENDING_CLEAR_TIMERS.pop((server_key, steam_id), None)
    except Exception as exc:  # noqa: BLE001
        log.warning("battle HUD clear failed: %s", exc)


def schedule_clear_battle_hud(
    server_state,
    steam_ids: list[str],
    *,
    delay_sec: int | None = None,
) -> None:
    """Delete battle HUD keys after a delay so clients can read terminal snapshots."""
    if not settings.BATTLE_HUD_ENABLED or not settings.REDIS_HOST:
        return
    if not steam_ids:
        return

    delay = delay_sec if delay_sec is not None else settings.HUD_BATTLE_CLEAR_DELAY_SEC
    server_key = normalize_hud_key_part(display_server_name(server_state))

    def _run_clear() -> None:
        clear_battle_hud(server_state, steam_ids)

    with _CLEAR_TIMER_LOCK:
        for steam_id in steam_ids:
            timer_key = (server_key, steam_id)
            existing = _PENDING_CLEAR_TIMERS.pop(timer_key, None)
            if existing is not None:
                existing.cancel()
            timer = threading.Timer(delay, _run_clear)
            timer.daemon = True
            _PENDING_CLEAR_TIMERS[timer_key] = timer
            timer.start()


def reset_debounce_for_tests() -> None:
    with _DEBOUNCE_LOCK:
        _LAST_PUBLISH_BY_PAIR.clear()
    with _CLEAR_TIMER_LOCK:
        for timer in _PENDING_CLEAR_TIMERS.values():
            timer.cancel()
        _PENDING_CLEAR_TIMERS.clear()
