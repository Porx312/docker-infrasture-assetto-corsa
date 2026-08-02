"""ACSP CAR_INFO (54) handler."""

from __future__ import annotations

from core import settings
from core.driver_lifecycle import now_ms, try_purge_ghost_car_info_slot
from core.handlers.common import mark_driver_seen
from core.logging_config import get_logger
from core.session_manager import DriverInfo, send_registration
from core.user_ban_enforcer import is_steam_id_banned, kick_driver

log = get_logger("packet_handlers")


def handle_car_info(parser, server_state, addr) -> None:
    car_id = parser.read_uint8()
    if car_id is None:
        return
    is_connected = parser.read_uint8()
    model = parser.read_wstring()
    _skin = parser.read_wstring()
    name = parser.read_wstring()
    _team = parser.read_wstring()
    guid = parser.read_wstring()

    if is_connected == 0 or not name or not guid:
        try_purge_ghost_car_info_slot(server_state, car_id)
        return

    if not name or not guid:
        return

    suspects = getattr(server_state, "ghost_suspects", None)
    if suspects is not None:
        suspects.pop(car_id, None)

    driver = server_state.active_drivers.get(car_id)
    if not driver:
        driver = DriverInfo(name, guid, model)
        mark_driver_seen(driver)
        server_state.active_drivers[car_id] = driver
    else:
        driver.name = name
        driver.guid = guid
        driver.model = model
        mark_driver_seen(driver)

    if guid and not guid.startswith("unknown_"):
        server_state.guid_to_driver[guid] = driver
        server_state.last_known_by_car_id[car_id] = {
            "guid": guid,
            "name": name,
            "model": model,
            "seen_ms": now_ms(),
        }

    log.debug("[%s] car_info car=%s name=%s model=%s", server_state.port, car_id, name, model)
    server_state.battle_manager.set_driver_name(guid, name)

    if not guid.startswith("unknown_") and is_steam_id_banned(guid):
        log.info("[%s] CAR_INFO banned guid=%s car=%s", server_state.port, guid, car_id)
        kick_driver(server_state, driver, "user_invalidated")
        return

    current_ms = now_ms()
    last_car_update_ms = getattr(server_state, "last_car_update_ms", 0)
    last_reg_ms = getattr(server_state, "last_registration_ms", 0)
    if (
        current_ms - last_car_update_ms >= settings.CAR_UPDATE_WATCHDOG_MS
        and current_ms - last_reg_ms >= settings.REGISTRATION_REFRESH_MIN_MS
    ):
        send_registration(server_state, addr[0])
        server_state.last_registration_ms = current_ms
        log.info("[%s] re-subscribed realtime feed (no CAR_UPDATE)", server_state.port)
