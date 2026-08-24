"""Kick players invalidated in Convex (ban state written by ac-data in Redis)."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from core import settings
from core.logging_config import get_logger
from core.redis_pubsub_subscriber import parse_steam_id_message, run_pubsub_subscriber_loop
from core.server_registry import find_driver_by_steam_id
from core.session_manager import DriverInfo
from core.user_kick_common import execute_warn_then_kick, find_driver_on_server
from core.user_status_cache import (
    invalidate_banned_cache,
    read_banned_cached,
    seed_banned_cache,
    write_banned_cached,
)

if TYPE_CHECKING:
    from core.session_manager import ServerState

log = get_logger("user_ban_enforcer")

_subscriber_started = False
_subscriber_lock = threading.Lock()
_defer_ban_kick_lock = threading.Lock()
_defer_ban_kick_scheduled: set[tuple[int, str]] = set()


def reset_defer_ban_kick_scheduled_for_tests() -> None:
    with _defer_ban_kick_lock:
        _defer_ban_kick_scheduled.clear()


def user_invalidated_redis_key(steam_id: str) -> str:
    return f"{settings.USER_INVALIDATED_REDIS_PREFIX}{steam_id.strip()}"


def is_steam_id_banned(steam_id: str, *, quiet: bool = False, force_refresh: bool = False) -> bool:
    if not settings.USER_BAN_ENABLED:
        return False

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return False

    if not force_refresh:
        cached = read_banned_cached(trimmed)
    else:
        cached = None
    if cached is not None:
        if cached and not quiet:
            log.info("ban check: steamId=%s banned (cache)", trimmed)
        return cached

    if not settings.REDIS_HOST:
        return False

    try:
        from core.redis_client import get_redis_client

        redis = get_redis_client()
        banned = bool(redis.get(user_invalidated_redis_key(trimmed)))
        write_banned_cached(trimmed, banned)
        if banned and not quiet:
            log.info("ban check: steamId=%s banned (invalidated key)", trimmed)
        return banned
    except Exception as exc:
        log.warning("ban check failed for %s: %s", trimmed, exc)
        return False


def kick_banned_car(
    server_state: ServerState,
    car_id: int,
    guid: str,
    driver_name: str,
    reason: str,
    *,
    wait_client_loaded: bool = True,
) -> bool:
    kicked = execute_warn_then_kick(
        server_state,
        car_id,
        guid,
        settings.USER_INVALIDATED_KICK_MESSAGE,
        settings.USER_KICK_WARN_DELAY_SEC,
        log_label="ban",
        wait_client_loaded=wait_client_loaded,
    )
    if kicked:
        log.info(
            "[%s] ban kick car=%s guid=%s name=%s reason=%s",
            server_state.port,
            car_id,
            guid,
            driver_name,
            reason,
        )
    return kicked


def schedule_deferred_ban_kick(server_state: ServerState, driver: DriverInfo) -> None:
    """Give ac-data time to refresh Convex ban state via player_join before kicking."""
    if not settings.USER_BAN_ENABLED:
        return

    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return

    defer_key = (server_state.port, guid.strip())
    with _defer_ban_kick_lock:
        if defer_key in _defer_ban_kick_scheduled:
            return
        _defer_ban_kick_scheduled.add(defer_key)

    def _run() -> None:
        try:
            interval = settings.USER_BAN_DEFER_POLL_MS / 1000.0
            saw_banned = False
            for _ in range(settings.USER_BAN_DEFER_ATTEMPTS):
                time.sleep(interval)
                if is_steam_id_banned(guid, quiet=True, force_refresh=True):
                    saw_banned = True
                    continue
                if not saw_banned:
                    log.info(
                        "[%s] ban cleared after join refresh guid=%s",
                        server_state.port,
                        guid,
                    )
                    return

            if not saw_banned:
                return

            current = find_driver_on_server(server_state, guid)
            if current is None:
                log.info(
                    "[%s] deferred ban kick skipped (driver gone) guid=%s",
                    server_state.port,
                    guid,
                )
                return

            kick_driver(server_state, current, "user_invalidated", wait_client_loaded=False)
        finally:
            with _defer_ban_kick_lock:
                _defer_ban_kick_scheduled.discard(defer_key)

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
    wait_client_loaded: bool = True,
) -> None:
    car_id = driver.car_id
    guid = driver.guid
    if car_id is None:
        log.warning("[%s] kick skipped (no car_id) guid=%s reason=%s", server_state.port, guid, reason)
        return

    kick_banned_car(
        server_state,
        car_id,
        guid,
        driver.name,
        reason,
        wait_client_loaded=wait_client_loaded,
    )
    if guid:
        server_state.battle_manager.remove_car(guid)


def maybe_kick_banned_driver_on_car_update(
    server_state: ServerState,
    driver: DriverInfo,
) -> None:
    """Mid-session ban via Convex webhook — one warn-then-kick per connection."""
    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return
    if not is_steam_id_banned(guid, quiet=True):
        return

    log.info(
        "[%s] CAR_UPDATE banned guid=%s car=%s — kicking",
        server_state.port,
        guid,
        driver.car_id,
    )
    kick_driver(server_state, driver, "user_invalidated_mid_session", wait_client_loaded=False)


def kick_steam_id_everywhere(steam_id: str, reason: str = "user_invalidated") -> int:
    if not settings.USER_BAN_ENABLED:
        return 0

    matches = find_driver_by_steam_id(steam_id)
    kicked = 0
    for server_state, driver in matches:
        kick_driver(server_state, driver, reason, wait_client_loaded=False)
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
    steam_id = parse_steam_id_message(raw)
    if not steam_id:
        return
    seed_banned_cache(steam_id, True)
    kick_steam_id_everywhere(steam_id)


def _ban_subscriber_loop() -> None:
    run_pubsub_subscriber_loop(
        settings.USER_INVALIDATED_CHANNEL,
        _handle_invalidation_message,
        log_label="user ban subscriber",
    )


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
