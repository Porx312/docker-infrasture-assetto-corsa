"""Shared driver ghost purge and player_leave emission."""

from __future__ import annotations

import time
from typing import Optional

from core import settings
from core.cm_name import display_server_name
from core.logging_config import get_logger
from network.event_dispatcher import send_server_event

log = get_logger("driver_lifecycle")


def now_ms() -> int:
    return int(time.time() * 1000)


def is_driver_stale(driver, at_ms: Optional[int] = None) -> bool:
    last_seen = getattr(driver, "last_seen_ms", 0)
    if last_seen <= 0:
        return False
    current = at_ms if at_ms is not None else now_ms()
    return (current - last_seen) > settings.GHOST_DRIVER_TIMEOUT_MS


def emit_player_leave(server_state, steam_id: str, *, name: str | None = None) -> None:
    if not steam_id or steam_id.startswith("unknown_"):
        return
    payload: dict[str, str] = {
        "steamId": steam_id,
        "trackName": server_state.track,
        "trackConfig": server_state.config,
    }
    if name and name.strip():
        payload["name"] = name.strip()
    send_server_event(
        "player_leave",
        display_server_name(server_state),
        payload,
    )


def remove_driver(
    server_state,
    car_id: int,
    driver,
    *,
    emit_leave: bool = True,
    log_label: str = "removed",
) -> None:
    if emit_leave:
        emit_player_leave(server_state, driver.guid, name=driver.name)

    server_state.battle_manager.remove_car(driver.guid)
    if driver.guid in server_state.guid_to_driver:
        del server_state.guid_to_driver[driver.guid]
    if car_id in server_state.active_drivers:
        del server_state.active_drivers[car_id]

    suspects = getattr(server_state, "ghost_suspects", None)
    if suspects is not None:
        suspects.pop(car_id, None)

    log.info("[%s] %s car=%s name=%s", server_state.port, log_label, car_id, driver.name)


def purge_stale_drivers(server_state, at_ms: Optional[int] = None, *, emit_leave: bool = True) -> int:
    """Remove drivers whose last_seen exceeds GHOST_DRIVER_TIMEOUT_MS."""
    current = at_ms if at_ms is not None else now_ms()
    removed = 0
    for car_id, driver in list(server_state.active_drivers.items()):
        if not is_driver_stale(driver, current):
            continue
        remove_driver(server_state, car_id, driver, emit_leave=emit_leave, log_label="ghost purge")
        removed += 1
    return removed


def drop_stale_drivers_on_new_session(server_state, at_ms: Optional[int] = None) -> int:
    """NEW_SESSION cleanup — same threshold as status loop."""
    current = at_ms if at_ms is not None else now_ms()
    removed = 0
    for car_id, driver in list(server_state.active_drivers.items()):
        last_seen = getattr(driver, "last_seen_ms", 0)
        if last_seen <= 0:
            continue
        if (current - last_seen) <= settings.GHOST_DRIVER_TIMEOUT_MS:
            continue
        remove_driver(
            server_state,
            car_id,
            driver,
            emit_leave=False,
            log_label="NEW_SESSION ghost",
        )
        removed += 1
    if removed:
        log.info("[%s] NEW_SESSION cleanup removed %d ghost(s)", server_state.port, removed)
    return removed


def try_purge_ghost_car_info_slot(server_state, car_id: int, at_ms: Optional[int] = None) -> bool:
    """
    CAR_INFO empty/disconnected slot debounce + stale check.
    Returns True if driver was removed.
    """
    driver = server_state.active_drivers.get(car_id)
    if not driver:
        return False

    current = at_ms if at_ms is not None else now_ms()
    suspects = getattr(server_state, "ghost_suspects", None)
    if suspects is None:
        suspects = {}
        server_state.ghost_suspects = suspects

    first_seen = suspects.get(car_id, 0)
    if not first_seen:
        suspects[car_id] = current
        return False
    if current - first_seen < settings.GHOST_CARINFO_DEBOUNCE_MS:
        return False
    suspects.pop(car_id, None)

    last_seen = getattr(driver, "last_seen_ms", 0)
    if last_seen > 0 and (current - last_seen) <= settings.GHOST_DRIVER_TIMEOUT_MS:
        return False

    remove_driver(server_state, car_id, driver, emit_leave=True, log_label="ghost cleanup")
    return True
