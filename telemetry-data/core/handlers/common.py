"""Shared helpers for ACSP packet handlers."""

from __future__ import annotations

import time

from core import runtime_config
from core.cm_name import strip_cm_name_suffix
from core.logging_config import get_logger

log = get_logger("packet_handlers")


def mark_driver_seen(driver) -> None:
    driver.last_seen_ms = int(time.time() * 1000)


def resolve_server_mode(server_state):
    mode = runtime_config.get_mode_for_state(server_state)
    if mode is not None or getattr(server_state, "_mode_lookup_logged", False):
        return mode
    server_state._mode_lookup_logged = True
    if not runtime_config.has_data():
        log.warning(
            "[%s] runtime_config empty — no battle/time-attack until ac:config snapshot "
            "(is ac-data running and REDIS_CONFIG_CONSUMER_ENABLED=true?)",
            server_state.port,
        )
    else:
        log.warning(
            "[%s] no mode for folder=%r ini_name=%r ac_name=%r; convex modes=%s",
            server_state.port,
            getattr(server_state, "server_folder_id", ""),
            strip_cm_name_suffix(getattr(server_state, "config_server_name", "") or ""),
            strip_cm_name_suffix(getattr(server_state, "server_name", "") or ""),
            runtime_config.snapshot(),
        )
    return mode


def ensure_last_known_cache(server_state) -> None:
    if not hasattr(server_state, "last_known_by_car_id"):
        server_state.last_known_by_car_id = {}
