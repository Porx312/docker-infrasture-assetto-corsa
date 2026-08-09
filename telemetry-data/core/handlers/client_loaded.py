"""ACSP CLIENT_LOADED (58) handler."""

from __future__ import annotations

from core import settings
from core.logging_config import get_logger
from core.user_ban_enforcer import is_steam_id_banned, kick_driver
from core.user_registration_enforcer import is_steam_id_not_registered, kick_unregistered_driver

log = get_logger("packet_handlers")


def handle_client_loaded(parser, server_state, addr) -> None:
    del addr
    car_id = parser.read_uint8()
    if car_id is None:
        return

    driver = server_state.active_drivers.get(car_id)
    if not driver:
        cached = server_state.last_known_by_car_id.get(car_id, {})
        guid = cached.get("guid")
        if not guid or guid.startswith("unknown_"):
            return
        from core.session_manager import DriverInfo

        driver = DriverInfo(
            cached.get("name") or "Driver",
            guid,
            cached.get("model") or "Unknown",
        )
        driver.car_id = car_id

    driver.client_loaded = True
    driver.car_id = car_id
    guid = driver.guid
    if not guid or guid.startswith("unknown_"):
        return

    if is_steam_id_banned(guid):
        log.info("[%s] CLIENT_LOADED banned guid=%s car=%s", server_state.port, guid, car_id)
        kick_driver(server_state, driver, "user_invalidated_client_loaded", wait_client_loaded=False)
        return

    if settings.USER_REGISTRATION_REQUIRED and is_steam_id_not_registered(guid):
        log.info("[%s] CLIENT_LOADED not registered guid=%s car=%s", server_state.port, guid, car_id)
        kick_unregistered_driver(
            server_state,
            driver,
            "user_not_found_client_loaded",
            wait_client_loaded=False,
        )
