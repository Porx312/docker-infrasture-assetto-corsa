"""Kick players invalidated in Convex (ban state written by ac-data in Redis)."""

from __future__ import annotations

import json
import threading
import time
from typing import TYPE_CHECKING, Any

from core import settings
from core.logging_config import get_logger
from core.server_registry import all_servers, find_driver_by_steam_id
from core.session_manager import send_admin_command, send_chat, send_kick_user

if TYPE_CHECKING:
    from core.session_manager import DriverInfo, ServerState

log = get_logger("user_ban_enforcer")

_subscriber_started = False
_subscriber_lock = threading.Lock()


def user_invalidated_redis_key(steam_id: str) -> str:
    return f"{settings.USER_INVALIDATED_REDIS_PREFIX}{steam_id.strip()}"


def hud_player_redis_key(steam_id: str) -> str:
    return f"ac:hud:player:{steam_id.strip()}"


def _parse_hud_player_banned(raw: str | None) -> bool:
    if not raw:
        return False
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return False

    if not isinstance(payload, dict):
        return False

    if payload.get("ok") is False and payload.get("reason") == "user_invalidated":
        return True

    profile = payload.get("profile")
    if isinstance(profile, dict) and (
        profile.get("isInvalidated") is True or profile.get("is_invalidated") is True
    ):
        return True

    return False


def is_steam_id_banned(steam_id: str, *, quiet: bool = False) -> bool:
    if not settings.USER_BAN_ENABLED:
        return False

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return False

    if not settings.REDIS_HOST:
        return False

    try:
        from core.redis_client import get_redis_client

        redis = get_redis_client()
        if redis.get(user_invalidated_redis_key(trimmed)):
            if not quiet:
                log.info("ban check: steamId=%s banned (invalidated key)", trimmed)
            return True
        return False
    except Exception as exc:
        log.warning("ban check failed for %s: %s", trimmed, exc)
        return False


_BAN_KICK_RETRY_DELAYS_SEC = (0.5, 1.5, 3.0, 5.0, 8.0)
_CAR_UPDATE_KICK_THROTTLE_MS = 3000
_last_car_update_kick_ms: dict[tuple[int, str], int] = {}


def _cleanup_driver(
    server_state: ServerState,
    driver: DriverInfo,
    *,
    keep_car_cache: bool = False,
) -> None:
    car_id = driver.car_id
    guid = driver.guid

    if guid and guid in server_state.guid_to_driver:
        del server_state.guid_to_driver[guid]

    if car_id is not None and car_id in server_state.active_drivers:
        del server_state.active_drivers[car_id]

    if car_id is not None and not keep_car_cache:
        last_known = getattr(server_state, "last_known_by_car_id", None)
        if isinstance(last_known, dict):
            last_known.pop(car_id, None)

    if guid:
        server_state.battle_manager.remove_car(guid)


def _send_ban_kick_packets(
    server_state: ServerState,
    car_id: int,
    driver_name: str | None = None,
) -> None:
    send_kick_user(server_state, car_id)
    send_admin_command(server_state, f"/kick_id {car_id}")
    if driver_name:
        send_admin_command(server_state, f"/kick {driver_name}")


def _schedule_ban_kick_retries(
    server_state: ServerState,
    car_id: int,
    guid: str,
    driver_name: str | None = None,
) -> None:
    def _run() -> None:
        for delay in _BAN_KICK_RETRY_DELAYS_SEC:
            time.sleep(delay)
            if not is_steam_id_banned(guid, quiet=True):
                return
            current = _find_driver_on_server(server_state, guid)
            target_car_id = current.car_id if current and current.car_id is not None else car_id
            _send_ban_kick_packets(server_state, target_car_id)

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"ban-kick-{server_state.port}-{car_id}",
    ).start()


def kick_banned_car(
    server_state: ServerState,
    car_id: int,
    guid: str,
    driver_name: str,
    reason: str,
    *,
    send_message: bool = True,
) -> None:
    if send_message:
        message = settings.USER_BAN_KICK_MESSAGE.strip()
        if message:
            send_chat(server_state, car_id, message)

    _send_ban_kick_packets(server_state, car_id, driver_name)
    _schedule_ban_kick_retries(server_state, car_id, guid, driver_name)
    log.info(
        "[%s] ban kick car=%s guid=%s name=%s reason=%s",
        server_state.port,
        car_id,
        guid,
        driver_name,
        reason,
    )


def _find_driver_on_server(server_state: ServerState, guid: str) -> DriverInfo | None:
    driver = server_state.guid_to_driver.get(guid)
    if driver is not None:
        return driver

    for candidate in server_state.active_drivers.values():
        if candidate.guid == guid:
            return candidate

    last_known = getattr(server_state, "last_known_by_car_id", None)
    if isinstance(last_known, dict):
        for car_id, meta in last_known.items():
            if meta.get("guid") == guid:
                found = DriverInfo(
                    meta.get("name") or "Driver",
                    guid,
                    meta.get("model") or "Unknown",
                )
                found.car_id = car_id
                return found

    return None


def schedule_deferred_ban_kick(server_state: ServerState, driver: DriverInfo) -> None:
    """Give ac-data time to refresh Convex ban state via player_join before kicking."""
    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return

    def _run() -> None:
        interval = settings.USER_BAN_DEFER_POLL_MS / 1000.0
        for _ in range(settings.USER_BAN_DEFER_ATTEMPTS):
            time.sleep(interval)
            if not is_steam_id_banned(guid, quiet=True):
                log.info(
                    "[%s] ban cleared after join refresh guid=%s",
                    server_state.port,
                    guid,
                )
                return

        current = _find_driver_on_server(server_state, guid)
        if current is None:
            log.info(
                "[%s] deferred ban kick skipped (driver gone) guid=%s",
                server_state.port,
                guid,
            )
            return

        kick_driver(server_state, current, "user_invalidated")

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"ban-defer-{server_state.port}-{guid[-6:]}",
    ).start()


def kick_driver(
    server_state: ServerState,
    driver: DriverInfo,
    reason: str,
    *,
    send_message: bool = True,
) -> None:
    car_id = driver.car_id
    guid = driver.guid
    if car_id is None:
        log.warning("[%s] kick skipped (no car_id) guid=%s reason=%s", server_state.port, guid, reason)
        return

    kick_banned_car(server_state, car_id, guid, driver.name, reason, send_message=send_message)
    if guid:
        server_state.battle_manager.remove_car(guid)


def maybe_kick_banned_driver_on_car_update(
    server_state: ServerState,
    driver: DriverInfo,
) -> None:
    """Mid-session ban via Convex webhook: keep kicking while CAR_UPDATE still flows."""
    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return
    if not is_steam_id_banned(guid, quiet=True):
        return

    now_ms = int(time.time() * 1000)
    throttle_key = (server_state.port, guid)
    last_ms = _last_car_update_kick_ms.get(throttle_key, 0)
    if now_ms - last_ms < _CAR_UPDATE_KICK_THROTTLE_MS:
        return
    _last_car_update_kick_ms[throttle_key] = now_ms

    log.info(
        "[%s] CAR_UPDATE banned guid=%s car=%s — kicking",
        server_state.port,
        guid,
        driver.car_id,
    )
    kick_driver(
        server_state,
        driver,
        "user_invalidated_mid_session",
        send_message=False,
    )


def kick_steam_id_everywhere(steam_id: str, reason: str = "user_invalidated") -> int:
    if not settings.USER_BAN_ENABLED:
        return 0

    matches = find_driver_by_steam_id(steam_id)
    kicked = 0
    for server_state, driver in matches:
        kick_driver(server_state, driver, reason)
        kicked += 1

    if kicked == 0:
        log.warning(
            "pub/sub ban kick: steamId=%s reason=%s but no active driver found on any server",
            steam_id,
            reason,
        )
    else:
        log.info(
            "pub/sub ban kick: steamId=%s reason=%s targets=%d",
            steam_id,
            reason,
            kicked,
        )
    return kicked


def _handle_invalidation_message(raw: str) -> None:
    trimmed = raw.strip()
    if not trimmed:
        return

    steam_id: str | None = None
    try:
        payload: Any = json.loads(trimmed)
        if isinstance(payload, dict):
            value = payload.get("steamId") or payload.get("steam_id")
            if isinstance(value, str) and value.strip():
                steam_id = value.strip()
    except (TypeError, json.JSONDecodeError):
        pass

    if steam_id is None:
        steam_id = trimmed

    kick_steam_id_everywhere(steam_id)


def _ban_subscriber_loop() -> None:
    if not settings.REDIS_HOST:
        log.info("user ban subscriber disabled (REDIS_HOST missing)")
        return

    try:
        from core.redis_client import get_redis_blocking_client

        redis = get_redis_blocking_client()
        pubsub = redis.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(settings.USER_INVALIDATED_CHANNEL)
        log.info("user ban subscriber listening on %s", settings.USER_INVALIDATED_CHANNEL)

        for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            data = message.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            if isinstance(data, str):
                _handle_invalidation_message(data)
    except Exception:
        log.exception("user ban subscriber stopped")


def start_user_ban_subscriber() -> None:
    global _subscriber_started

    if not settings.USER_BAN_ENABLED:
        log.info("user ban enforcement disabled (USER_BAN_ENABLED=false)")
        return

    with _subscriber_lock:
        if _subscriber_started:
            return
        _subscriber_started = True

    thread = threading.Thread(target=_ban_subscriber_loop, name="user-ban-subscriber", daemon=True)
    thread.start()
