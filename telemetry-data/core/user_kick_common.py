"""Shared warn-then-kick flow with per-connection deduplication."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from core.logging_config import get_logger
from core.session_manager import DriverInfo, send_admin_command, send_chat, send_kick_user

if TYPE_CHECKING:
    from core.session_manager import ServerState

log = get_logger("user_kick_common")

_lock = threading.Lock()
_in_progress: set[tuple[int, str]] = set()
_done: set[tuple[int, str]] = set()

_CLIENT_LOADED_POLL_SEC = 0.2
_CMD_ADDR_POLL_SEC = 0.1


def _kick_key(port: int, guid: str) -> tuple[int, str]:
    return (port, guid.strip())


def clear_kick_state(port: int, guid: str, car_id: int | None = None) -> None:
    """Allow a future kick after reconnect."""
    del car_id
    with _lock:
        key = _kick_key(port, guid)
        _in_progress.discard(key)
        _done.discard(key)


def reset_kick_state_for_tests() -> None:
    with _lock:
        _in_progress.clear()
        _done.clear()


def find_driver_on_server(server_state: ServerState, guid: str) -> DriverInfo | None:
    driver = server_state.guid_to_driver.get(guid)
    if driver is not None:
        return driver

    for candidate in server_state.active_drivers.values():
        if candidate.guid == guid:
            return candidate

    last_known = getattr(server_state, "last_known_by_car_id", None)
    if isinstance(last_known, dict):
        for car_id, meta in last_known.items():
            if meta.get("guid") == guid:
                found = DriverInfo(
                    meta.get("name") or "Driver",
                    guid,
                    meta.get("model") or "Unknown",
                )
                found.car_id = car_id
                return found

    return None


def _try_begin_kick(port: int, guid: str) -> bool:
    with _lock:
        key = _kick_key(port, guid)
        if key in _done or key in _in_progress:
            return False
        _in_progress.add(key)
        return True


def _finish_kick(port: int, guid: str) -> None:
    with _lock:
        key = _kick_key(port, guid)
        _in_progress.discard(key)
        _done.add(key)


def _abort_kick(port: int, guid: str) -> None:
    with _lock:
        key = _kick_key(port, guid)
        _in_progress.discard(key)
        _done.discard(key)


def _wait_for_cmd_addr(server_state: ServerState, timeout_sec: float) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if server_state.last_server_addr and server_state.sock:
            return True
        time.sleep(_CMD_ADDR_POLL_SEC)
    return False


def _wait_for_client_loaded(
    server_state: ServerState,
    guid: str,
    timeout_sec: float,
) -> DriverInfo | None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        driver = find_driver_on_server(server_state, guid)
        if driver is None:
            return None
        if getattr(driver, "client_loaded", False) and driver.car_id is not None:
            return driver
        time.sleep(_CLIENT_LOADED_POLL_SEC)
    return find_driver_on_server(server_state, guid)


def _send_kick_once(server_state: ServerState, car_id: int) -> bool:
    if not server_state.last_server_addr or not server_state.sock:
        return False
    send_kick_user(server_state, car_id)
    send_admin_command(server_state, f"/kick_id {car_id}")
    return True


def execute_warn_then_kick(
    server_state: ServerState,
    car_id: int,
    guid: str,
    message: str,
    warn_delay_sec: float,
    *,
    log_label: str,
    wait_client_loaded: bool = True,
    client_loaded_timeout_sec: float = 45.0,
    cmd_addr_timeout_sec: float = 10.0,
) -> bool:
    """Chat warning, wait, then one kick. Waits for UDP cmd addr + CLIENT_LOADED when possible."""
    trimmed_guid = (guid or "").strip()
    if not trimmed_guid:
        return False

    if not _try_begin_kick(server_state.port, trimmed_guid):
        log.debug(
            "[%s] %s kick skipped (already done) guid=%s",
            server_state.port,
            log_label,
            trimmed_guid,
        )
        return False

    success = False
    try:
        if not _wait_for_cmd_addr(server_state, cmd_addr_timeout_sec):
            log.warning(
                "[%s] %s kick aborted (no cmd addr) guid=%s",
                server_state.port,
                log_label,
                trimmed_guid,
            )
            return False

        if wait_client_loaded:
            resolved = _wait_for_client_loaded(
                server_state,
                trimmed_guid,
                client_loaded_timeout_sec,
            )
        else:
            resolved = find_driver_on_server(server_state, trimmed_guid)

        if resolved is None:
            log.info(
                "[%s] %s kick aborted (driver gone) guid=%s",
                server_state.port,
                log_label,
                trimmed_guid,
            )
            return False

        target_car_id = resolved.car_id if resolved.car_id is not None else car_id
        if target_car_id is None:
            log.warning(
                "[%s] %s kick aborted (no car_id) guid=%s",
                server_state.port,
                log_label,
                trimmed_guid,
            )
            return False

        send_chat(server_state, target_car_id, message)
        log.info(
            "[%s] %s warning sent car=%s guid=%s",
            server_state.port,
            log_label,
            target_car_id,
            trimmed_guid,
        )

        if warn_delay_sec > 0:
            time.sleep(warn_delay_sec)

        if not _send_kick_once(server_state, target_car_id):
            log.warning(
                "[%s] %s kick failed (send) car=%s guid=%s",
                server_state.port,
                log_label,
                target_car_id,
                trimmed_guid,
            )
            return False

        log.info(
            "[%s] %s kick sent car=%s guid=%s",
            server_state.port,
            log_label,
            target_car_id,
            trimmed_guid,
        )
        success = True
        return True
    finally:
        if success:
            _finish_kick(server_state.port, trimmed_guid)
        else:
            _abort_kick(server_state.port, trimmed_guid)
