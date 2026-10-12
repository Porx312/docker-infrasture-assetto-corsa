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


def _note_suppressed(server_state, track: str, config: str, current_ms: int) -> None:
    suppressed = getattr(server_state, "_new_session_suppressed", 0) + 1
    server_state._new_session_suppressed = suppressed
    server_state._new_session_log_ms = current_ms
    every = max(1, settings.NEW_SESSION_SUPPRESS_LOG_EVERY)
    if suppressed % every == 0:
        log.warning(
            "[%s] suppressed %d duplicate NEW_SESSION (track=%s config=%s) — "
            "AC may be in a session restart loop",
            server_state.port,
            suppressed,
            track,
            config,
        )


def handle_new_session(parser, server_state, addr) -> None:
    current_ms = now_ms()

    parser.read_uint8()  # version
    parser.read_uint8()  # sessionIndex
    parser.read_uint8()  # currentSessionIndex
    parser.read_uint8()  # sessionCount

    server_name = parser.read_wstring()
    track = parser.read_string()
    config = parser.read_string()

    fingerprint = (server_name, track, config)
    last_fp = getattr(server_state, "_new_session_fingerprint", None)

    # Identical session: never re-read ini / re-log; only periodic suppress warnings.
    # (AC sometimes storms NEW_SESSION at tens/sec — disk I/O + log spam.)
    if last_fp is not None and last_fp == fingerprint:
        _note_suppressed(server_state, track, config, current_ms)
        # Still refresh plugin registration on the normal cadence (no flood).
        last_reg_ms = getattr(server_state, "last_registration_ms", 0)
        if current_ms - last_reg_ms >= settings.REGISTRATION_REFRESH_MIN_MS:
            send_registration(server_state, addr[0])
            server_state.last_registration_ms = current_ms
        return

    prev_suppressed = getattr(server_state, "_new_session_suppressed", 0)
    if prev_suppressed:
        log.info(
            "[%s] NEW_SESSION fingerprint changed after %d suppressed duplicates",
            server_state.port,
            prev_suppressed,
        )
    server_state._new_session_suppressed = 0
    server_state._new_session_fingerprint = fingerprint
    server_state._new_session_log_ms = current_ms

    server_state.server_name = server_name
    server_state.track = track
    server_state.config = config

    drop_stale_drivers_on_new_session(server_state, current_ms)

    last_reg_ms = getattr(server_state, "last_registration_ms", 0)
    if current_ms - last_reg_ms >= settings.REGISTRATION_REFRESH_MIN_MS:
        send_registration(server_state, addr[0])
        server_state.last_registration_ms = current_ms

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
