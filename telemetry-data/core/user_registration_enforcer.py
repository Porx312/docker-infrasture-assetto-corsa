"""Kick players without a ProjectD account (user_not_found state written by ac-data in Redis)."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from core import settings
from core.logging_config import get_logger
from core.redis_pubsub_subscriber import parse_steam_id_message, run_pubsub_subscriber_loop
from core.server_registry import find_driver_by_steam_id
from core.session_manager import DriverInfo
from core.user_ban_enforcer import is_steam_id_banned
from core.user_kick_common import execute_warn_then_kick, find_driver_on_server
from core.user_status_cache import read_not_registered_cached, write_not_registered_cached

if TYPE_CHECKING:
    from core.session_manager import ServerState

log = get_logger("user_registration_enforcer")

_subscriber_started = False
_subscriber_lock = threading.Lock()


def user_not_registered_redis_key(steam_id: str) -> str:
    return f"{settings.USER_NOT_REGISTERED_REDIS_PREFIX}{steam_id.strip()}"


def is_steam_id_not_registered(steam_id: str, *, quiet: bool = False) -> bool:
    if not settings.USER_REGISTRATION_REQUIRED:
        return False

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return False

    if is_steam_id_banned(trimmed, quiet=True):
        return False

    cached = read_not_registered_cached(trimmed)
    if cached is not None:
        if cached and not quiet:
            log.info("registration check: steamId=%s not registered (cache)", trimmed)
        return cached

    if not settings.REDIS_HOST:
        return False

    try:
        from core.redis_client import get_redis_client

        redis = get_redis_client()
        not_registered = bool(redis.get(user_not_registered_redis_key(trimmed)))
        write_not_registered_cached(trimmed, not_registered)
        if not_registered and not quiet:
            log.info("registration check: steamId=%s not registered", trimmed)
        return not_registered
    except Exception as exc:
        log.warning("registration check failed for %s: %s", trimmed, exc)
        return False


def kick_unregistered_car(
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
        settings.USER_NOT_REGISTERED_KICK_MESSAGE,
        settings.USER_KICK_WARN_DELAY_SEC,
        log_label="registration",
        wait_client_loaded=wait_client_loaded,
    )
    if kicked:
        log.info(
            "[%s] registration kick car=%s guid=%s name=%s reason=%s",
            server_state.port,
            car_id,
            guid,
            driver_name,
            reason,
        )
    return kicked


def kick_unregistered_driver(
    server_state: ServerState,
    driver: DriverInfo,
    reason: str,
    *,
    wait_client_loaded: bool = True,
) -> None:
    car_id = driver.car_id
    guid = driver.guid
    if car_id is None:
        log.warning(
            "[%s] registration kick skipped (no car_id) guid=%s reason=%s",
            server_state.port,
            guid,
            reason,
        )
        return

    kick_unregistered_car(
        server_state,
        car_id,
        guid,
        driver.name,
        reason,
        wait_client_loaded=wait_client_loaded,
    )
    if guid:
        server_state.battle_manager.remove_car(guid)


def schedule_deferred_registration_kick(server_state: ServerState, driver: DriverInfo) -> None:
    """Give ac-data time to refresh Convex registration state via player_join before kicking."""
    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return

    def _run() -> None:
        interval = settings.USER_BAN_DEFER_POLL_MS / 1000.0
        for _ in range(settings.USER_BAN_DEFER_ATTEMPTS):
            time.sleep(interval)
            if is_steam_id_banned(guid, quiet=True):
                log.info(
                    "[%s] registration defer skipped (banned) guid=%s",
                    server_state.port,
                    guid,
                )
                return
            if not is_steam_id_not_registered(guid, quiet=True):
                log.info(
                    "[%s] registration cleared after join refresh guid=%s",
                    server_state.port,
                    guid,
                )
                return

        current = find_driver_on_server(server_state, guid)
        if current is None:
            log.info(
                "[%s] deferred registration kick skipped (driver gone) guid=%s",
                server_state.port,
                guid,
            )
            return

        if is_steam_id_banned(guid, quiet=True):
            return

        kick_unregistered_driver(server_state, current, "user_not_found")

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"registration-defer-{server_state.port}-{guid[-6:]}",
    ).start()


def maybe_kick_unregistered_driver_on_car_update(
    server_state: ServerState,
    driver: DriverInfo,
) -> None:
    """Mid-session kick when ac-data marks player as not registered — one per connection."""
    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return
    if is_steam_id_banned(guid, quiet=True):
        return
    if not is_steam_id_not_registered(guid, quiet=True):
        return

    log.info(
        "[%s] CAR_UPDATE not registered guid=%s car=%s — kicking",
        server_state.port,
        guid,
        driver.car_id,
    )
    kick_unregistered_driver(server_state, driver, "user_not_found_mid_session", wait_client_loaded=False)


def kick_steam_id_everywhere_unregistered(
    steam_id: str,
    reason: str = "user_not_found",
) -> int:
    if not settings.USER_REGISTRATION_REQUIRED:
        return 0

    if is_steam_id_banned(steam_id, quiet=True):
        return 0

    matches = find_driver_by_steam_id(steam_id)
    kicked = 0
    for server_state, driver in matches:
        kick_unregistered_driver(server_state, driver, reason, wait_client_loaded=False)
        kicked += 1

    if kicked == 0:
        log.warning(
            "pub/sub registration kick: steamId=%s reason=%s but no active driver found on any server",
            steam_id,
            reason,
        )
    else:
        log.info(
            "pub/sub registration kick: steamId=%s reason=%s targets=%d",
            steam_id,
            reason,
            kicked,
        )
    return kicked


def _handle_not_registered_message(raw: str) -> None:
    steam_id = parse_steam_id_message(raw)
    if not steam_id:
        return
    kick_steam_id_everywhere_unregistered(steam_id)


def _registration_subscriber_loop() -> None:
    run_pubsub_subscriber_loop(
        settings.USER_NOT_REGISTERED_CHANNEL,
        _handle_not_registered_message,
        log_label="user registration subscriber",
    )


def start_user_registration_subscriber() -> None:
    global _subscriber_started

    if not settings.USER_REGISTRATION_REQUIRED:
        log.info("user registration enforcement disabled (USER_REGISTRATION_REQUIRED=false)")
        return

    with _subscriber_lock:
        if _subscriber_started:
            return
        _subscriber_started = True

    thread = threading.Thread(
        target=_registration_subscriber_loop,
        name="user-registration-subscriber",
        daemon=True,
    )
    thread.start()
