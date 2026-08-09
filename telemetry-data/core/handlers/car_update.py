"""ACSP CAR_UPDATE (53) handler."""

from __future__ import annotations

import time

from core import runtime_config
from core.handlers.common import mark_driver_seen, resolve_server_mode
from core.user_ban_enforcer import maybe_kick_banned_driver_on_car_update
from core.user_registration_enforcer import maybe_kick_unregistered_driver_on_car_update


def handle_car_update(parser, server_state, addr) -> None:
    del addr
    car_id = parser.read_uint8()
    if car_id is None:
        return
    pos_x = parser.read_float()
    pos_y = parser.read_float()
    pos_z = parser.read_float()
    v_x = parser.read_float()
    v_y = parser.read_float()
    v_z = parser.read_float()
    _gear = parser.read_uint8()
    _rpm = parser.read_uint16()
    spline = parser.read_float()

    driver = server_state.active_drivers.get(car_id)
    if not driver:
        return

    mark_driver_seen(driver)
    server_state.last_car_update_ms = int(time.time() * 1000)
    speed_ms = ((v_x or 0) ** 2 + (v_y or 0) ** 2 + (v_z or 0) ** 2) ** 0.5
    now = int(time.time() * 1000)

    server_mode = resolve_server_mode(server_state)
    meta = runtime_config.get_event_constraints_for_state(server_state)

    driver.car_id = car_id
    server_state.event_engine.check_idle(driver, speed_ms, now, meta)

    if not driver.guid.startswith("unknown_"):
        maybe_kick_banned_driver_on_car_update(server_state, driver)
        maybe_kick_unregistered_driver_on_car_update(server_state, driver)

    is_battle_server = runtime_config.battle_enabled(server_mode)
    server_state.battle_manager.set_server_mode(is_battle_server)

    if is_battle_server:
        server_state.battle_manager.update(
            driver.guid,
            spline,
            speed_ms * 3.6,
            (pos_x, pos_y, pos_z),
            vel=(v_x or 0.0, v_y or 0.0, v_z or 0.0),
        )
