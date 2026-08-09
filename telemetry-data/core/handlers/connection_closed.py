"""ACSP CONNECTION_CLOSED (52) handler."""

from __future__ import annotations

from core.driver_lifecycle import remove_driver
from core.logging_config import get_logger
from core.user_kick_common import clear_kick_state

log = get_logger("packet_handlers")


def handle_connection_closed(parser, server_state, addr) -> None:
    del addr
    _name = parser.read_wstring()
    _guid = parser.read_wstring()
    car_id = parser.read_uint8()
    if car_id is None:
        return

    driver = server_state.active_drivers.get(car_id)
    if not driver:
        return

    log.info("[%s] disconnected car=%s name=%s", server_state.port, car_id, driver.name)
    if driver.guid:
        clear_kick_state(server_state.port, driver.guid, car_id)
    remove_driver(server_state, car_id, driver, emit_leave=True, log_label="disconnected")
