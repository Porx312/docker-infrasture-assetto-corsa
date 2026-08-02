"""ACSP NEW_SESSION (50) handler."""

from __future__ import annotations

import os

from core import runtime_config, settings
from core.driver_lifecycle import drop_stale_drivers_on_new_session, now_ms
from core.handlers.common import resolve_server_mode
from core.ini_config import apply_ini_to_server_state
from core.logging_config import get_logger
from core.session_manager import send_registration

log = get_logger("packet_handlers")


def handle_new_session(parser, server_state, addr) -> None:
    current_ms = now_ms()
    drop_stale_drivers_on_new_session(server_state, current_ms)

    last_reg_ms = getattr(server_state, "last_registration_ms", 0)
    if current_ms - last_reg_ms >= settings.REGISTRATION_REFRESH_MIN_MS:
        send_registration(server_state, addr[0])
        server_state.last_registration_ms = current_ms

    parser.read_uint8()  # version
    parser.read_uint8()  # sessionIndex
    parser.read_uint8()  # currentSessionIndex
    parser.read_uint8()  # sessionCount

    server_state.server_name = parser.read_wstring()
    server_state.track = parser.read_string()
    server_state.config = parser.read_string()

    if server_state.cfg_path and os.path.exists(server_state.cfg_path):
        try:
            if apply_ini_to_server_state(server_state, server_state.cfg_path):
                log.info("[%s] config reloaded from %s", server_state.port, server_state.cfg_path)
        except Exception as exc:
            log.error("[%s] error reloading %s: %s", server_state.port, server_state.cfg_path, exc)

    server_mode = resolve_server_mode(server_state)
    is_battle_server = runtime_config.battle_enabled(server_mode)
    server_state.battle_manager.set_server_mode(is_battle_server)

    if server_mode:
        event_info = f" | 🎛️  Mode: {server_mode}"
    else:
        event_info = " | ⚠️  Mode unknown (waiting Redis snapshot)"

    log.info(
        "[%s] session track=%s config=%s name=%s%s",
        server_state.port,
        server_state.track,
        server_state.config,
        server_state.server_name,
        event_info,
    )
