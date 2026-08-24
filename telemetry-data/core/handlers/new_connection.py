"""ACSP NEW_CONNECTION (51) handler."""

from __future__ import annotations

import time

from core import settings
from core.cm_name import display_server_name
from core.handlers.common import mark_driver_seen
from core.logging_config import get_logger
from core.session_manager import DriverInfo
from core.user_ban_enforcer import schedule_deferred_ban_kick
from core.user_registration_enforcer import schedule_deferred_registration_kick
from core.user_status_cache import invalidate_banned_cache
from network.event_dispatcher import send_server_event

log = get_logger("packet_handlers")


def handle_new_connection(parser, server_state, addr) -> None:
    del addr
    name = parser.read_wstring()
    guid = parser.read_wstring()
    car_id = parser.read_uint8()
    if car_id is None:
        return
    model = parser.read_string()
    _skin = parser.read_string()

    if not name or not guid:
        return

    driver = DriverInfo(name, guid, model)
    mark_driver_seen(driver)
    driver.car_id = car_id
    server_state.active_drivers[car_id] = driver
    if guid and not guid.startswith("unknown_"):
        server_state.guid_to_driver[guid] = driver
        server_state.last_known_by_car_id[car_id] = {
            "guid": guid,
            "name": name,
            "model": model,
            "seen_ms": int(time.time() * 1000),
        }

    log.info("[%s] connected car=%s name=%s model=%s guid=%s", server_state.port, car_id, name, model, guid)
    server_state.battle_manager.set_driver_name(guid, name)

    driver.lap_start_time = time.time() * 1000
    driver.lap_notified_fail = False

    if not guid.startswith("unknown_"):
        send_server_event(
            "player_join",
            display_server_name(server_state),
            {
                "steamId": guid,
                "name": name,
                "carModel": model,
                "trackName": server_state.track,
                "trackConfig": server_state.config,
            },
        )

        invalidate_banned_cache(guid)

        if settings.USER_BAN_ENABLED:
            schedule_deferred_ban_kick(server_state, driver)

        if settings.USER_REGISTRATION_REQUIRED:
            defer_ms = settings.USER_BAN_DEFER_POLL_MS * settings.USER_BAN_DEFER_ATTEMPTS
            log.info(
                "[%s] join grace start guid=%s deferMs=%s",
                server_state.port,
                guid,
                defer_ms,
            )
            schedule_deferred_registration_kick(server_state, driver)
