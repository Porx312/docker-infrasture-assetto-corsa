"""ACSP CLIENT_EVENT (130) handler."""

from __future__ import annotations

from core import runtime_config
from core.handlers.common import resolve_server_mode
from network.ac_packet import ACSP


def handle_client_event(parser, server_state, addr) -> None:
    del addr
    ev_type = parser.read_uint8()
    car_id = parser.read_uint8()

    if ev_type == getattr(ACSP, "CE_COLLISION_WITH_CAR", 10):
        other_car_id = parser.read_uint8()
        impact_speed = parser.read_float()
        driver1 = server_state.active_drivers.get(car_id)
        driver2 = server_state.active_drivers.get(other_car_id)
        server_mode = resolve_server_mode(server_state)
        is_battle_server = runtime_config.battle_enabled(server_mode)
        server_state.battle_manager.set_server_mode(is_battle_server)
        if is_battle_server and driver1 and driver2:
            server_state.battle_manager.handle_collision(
                driver1.guid, driver2.guid, impact_speed
            )
    elif ev_type == getattr(ACSP, "CE_COLLISION_WITH_ENV", 11):
        pass

    if ev_type in (
        getattr(ACSP, "CE_COLLISION_WITH_CAR", 10),
        getattr(ACSP, "CE_COLLISION_WITH_ENV", 11),
    ):
        driver = server_state.active_drivers.get(car_id)
        if driver:
            driver.car_id = car_id
            server_mode = resolve_server_mode(server_state)
            if runtime_config.time_attack_enabled(server_mode):
                meta = runtime_config.get_event_constraints_for_state(server_state)
                server_state.event_engine.check_collision(driver, meta)
