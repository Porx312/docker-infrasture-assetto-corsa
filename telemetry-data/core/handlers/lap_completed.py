"""ACSP LAP_COMPLETED handler."""

from __future__ import annotations

import struct

from core import runtime_config, settings
from core.cm_name import display_server_name
from core.handlers.common import mark_driver_seen, resolve_server_mode
from core.logging_config import get_logger
from core.session_manager import DriverInfo
from network.event_dispatcher import send_server_event

log = get_logger("packet_handlers")


def handle_lap_completed(parser, server_state, addr) -> None:
    del addr
    car_id = parser.read_uint8()
    if car_id is None:
        return
    ac_lap_time = parser.read_uint32() or 0
    cuts = parser.read_uint8() or 0

    driver = server_state.active_drivers.get(car_id)

    if not driver:
        cached = server_state.last_known_by_car_id.get(car_id)
        if cached and cached.get("guid"):
            driver = DriverInfo(
                cached.get("name") or f"Driver_CarID_{car_id}",
                cached["guid"],
                cached.get("model") or "Unknown",
            )
            driver.car_id = car_id
            mark_driver_seen(driver)
            server_state.active_drivers[car_id] = driver
            if not driver.guid.startswith("unknown_"):
                server_state.guid_to_driver[driver.guid] = driver
        else:
            if server_state.last_server_addr:
                server_state.sock.sendto(struct.pack("BB", 201, car_id), server_state.last_server_addr)
            log.warning("[%s] LAP_COMPLETED unknown car=%s, waiting CAR_INFO", server_state.port, car_id)
            return
    else:
        mark_driver_seen(driver)

    if ac_lap_time <= 0 or ac_lap_time > 36000000:
        return

    if ac_lap_time < settings.MIN_VALID_LAP_MS:
        log.warning(
            "[%s] lap ignored suspicious time %.3fs < %.3fs",
            server_state.port,
            ac_lap_time / 1000,
            settings.MIN_VALID_LAP_MS / 1000,
        )
        return

    server_mode = resolve_server_mode(server_state)
    if runtime_config.battle_enabled(server_mode):
        server_state.battle_manager.set_server_mode(True)
        server_state.battle_manager.handle_lap_completed(driver.guid)

    if not runtime_config.time_attack_enabled(server_mode):
        log.info(
            "[%s] lap_completed SKIPPED mode=%r guid=%s car=%s lapMs=%s name=%s",
            server_state.port,
            server_mode,
            driver.guid,
            car_id,
            ac_lap_time,
            driver.name,
        )
        return

    driver.last_lap = ac_lap_time
    driver.lap_count += 1

    meta = runtime_config.get_event_constraints_for_state(server_state)

    driver.car_id = car_id
    is_valid, fail_reason = server_state.event_engine.evaluate_lap(driver, ac_lap_time, cuts, meta)

    if not is_valid:
        log.info(
            "[%s] lap invalid name=%s time=%.3fs cuts=%s (%s)",
            server_state.port,
            driver.name,
            ac_lap_time / 1000,
            cuts,
            fail_reason,
        )
        return

    if driver.best_lap == 0 or ac_lap_time < driver.best_lap:
        driver.best_lap = ac_lap_time
        is_personal_best = True
    else:
        is_personal_best = False

    log.info(
        "[%s] lap valid name=%s #%s time=%.3fs best=%.3fs",
        server_state.port,
        driver.name,
        driver.lap_count,
        ac_lap_time / 1000,
        driver.best_lap / 1000,
    )

    if not driver.guid.startswith("unknown_"):
        send_server_event(
            "lap_completed",
            display_server_name(server_state),
            {
                "steamId": driver.guid,
                "name": driver.name,
                "carModel": driver.model,
                "trackName": server_state.track,
                "trackConfig": server_state.config,
                "lapTime": ac_lap_time,
                "isPersonalBest": is_personal_best,
            },
        )
