"""Send private in-game chat to every connected instance of a steam id."""

from __future__ import annotations

from core.logging_config import get_logger
from core.server_registry import find_driver_by_steam_id
from core.session_manager import send_chat

log = get_logger("steam_id_chat_notify")


def notify_steam_id_chat(steam_id: str, message: str, *, log_label: str) -> int:
    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return 0

    matches = find_driver_by_steam_id(trimmed)
    sent = 0

    for server_state, driver in matches:
        car_id = driver.car_id
        if car_id is None:
            log.warning(
                "%s chat skipped: no car_id port=%s steamId=%s",
                log_label,
                server_state.port,
                trimmed,
            )
            continue
        if not server_state.last_server_addr:
            log.warning(
                "%s chat skipped: no cmd addr port=%s steamId=%s",
                log_label,
                server_state.port,
                trimmed,
            )
            continue
        send_chat(server_state, car_id, message)
        sent += 1
        log.info(
            "[%s] %s chat steamId=%s car=%s",
            server_state.port,
            log_label,
            trimmed,
            car_id,
        )

    if sent == 0:
        log.info(
            "%s chat: steamId=%s but no active driver with car_id",
            log_label,
            trimmed,
        )

    return sent
