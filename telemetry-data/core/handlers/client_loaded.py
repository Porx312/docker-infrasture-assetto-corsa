"""ACSP CLIENT_LOADED (58) handler."""

from __future__ import annotations

from core.logging_config import get_logger
from core.session_manager import DriverInfo
from core.user_ban_enforcer import is_steam_id_banned, kick_driver

log = get_logger("packet_handlers")


def handle_client_loaded(parser, server_state, addr) -> None:
    del addr
    car_id = parser.read_uint8()
    if car_id is None:
        return

    cached = server_state.last_known_by_car_id.get(car_id, {})
    guid = cached.get("guid")
    name = cached.get("name") or "Driver"
    model = cached.get("model") or "Unknown"
    driver = server_state.active_drivers.get(car_id)
    if driver:
        guid = driver.guid or guid
        name = driver.name or name
        model = driver.model or model

    if guid and not guid.startswith("unknown_") and is_steam_id_banned(guid):
        log.info("[%s] CLIENT_LOADED banned guid=%s car=%s", server_state.port, guid, car_id)
        if not driver:
            driver = DriverInfo(name, guid, model)
            driver.car_id = car_id
        kick_driver(server_state, driver, "user_invalidated_client_loaded")
