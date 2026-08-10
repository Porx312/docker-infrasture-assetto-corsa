"""Private in-game chat when acceptBattle pref changes (pub/sub from ac-data)."""

from __future__ import annotations

import json
import threading
from typing import Any

from core import settings
from core.logging_config import get_logger
from core.server_registry import find_driver_by_steam_id
from core.session_manager import send_chat

log = get_logger("user_prefs_notify")

_subscriber_started = False
_subscriber_lock = threading.Lock()


def accept_battle_enabled_message() -> str:
    return settings.USER_PREFS_ACCEPT_BATTLE_ENABLED_MESSAGE


def accept_battle_disabled_message() -> str:
    return settings.USER_PREFS_ACCEPT_BATTLE_DISABLED_MESSAGE


def notify_accept_battle_change(steam_id: str, accept_battle: bool) -> int:
    """Send private server chat to every connected instance of steam_id."""
    if not settings.USER_PREFS_NOTIFY_ENABLED:
        return 0

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return 0

    message = accept_battle_enabled_message() if accept_battle else accept_battle_disabled_message()
    matches = find_driver_by_steam_id(trimmed)
    sent = 0

    for server_state, driver in matches:
        car_id = driver.car_id
        if car_id is None:
            log.warning(
                "acceptBattle chat skipped: no car_id port=%s steamId=%s",
                server_state.port,
                trimmed,
            )
            continue
        if not server_state.last_server_addr:
            log.warning(
                "acceptBattle chat skipped: no cmd addr port=%s steamId=%s",
                server_state.port,
                trimmed,
            )
            continue
        send_chat(server_state, car_id, message)
        sent += 1
        log.info(
            "[%s] acceptBattle chat steamId=%s acceptBattle=%s car=%s",
            server_state.port,
            trimmed,
            accept_battle,
            car_id,
        )

    if sent == 0:
        log.info(
            "acceptBattle chat: steamId=%s acceptBattle=%s but no active driver with car_id",
            trimmed,
            accept_battle,
        )

    return sent


def _parse_accept_battle_message(raw: str) -> tuple[str, bool] | None:
    trimmed = raw.strip()
    if not trimmed:
        return None

    try:
        payload: Any = json.loads(trimmed)
    except (TypeError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    steam_raw = payload.get("steamId") or payload.get("steam_id")
    if not isinstance(steam_raw, str) or not steam_raw.strip():
        return None

    accept_raw = payload.get("acceptBattle")
    if accept_raw is None:
        accept_raw = payload.get("accept_battle")
    if accept_raw is not True and accept_raw is not False:
        return None

    return steam_raw.strip(), accept_raw


def _handle_prefs_notify_message(raw: str) -> None:
    parsed = _parse_accept_battle_message(raw)
    if parsed is None:
        log.warning("user prefs notify: invalid payload %r", raw[:200])
        return

    steam_id, accept_battle = parsed
    notify_accept_battle_change(steam_id, accept_battle)


def _prefs_notify_subscriber_loop() -> None:
    if not settings.REDIS_HOST:
        log.info("user prefs notify subscriber disabled (REDIS_HOST missing)")
        return

    try:
        from core.redis_client import get_redis_blocking_client

        redis = get_redis_blocking_client()
        pubsub = redis.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(settings.USER_PREFS_NOTIFY_CHANNEL)
        log.info(
            "user prefs notify subscriber listening on %s",
            settings.USER_PREFS_NOTIFY_CHANNEL,
        )

        for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            data = message.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            if isinstance(data, str):
                _handle_prefs_notify_message(data)
    except Exception:
        log.exception("user prefs notify subscriber stopped")


def start_user_prefs_notify_subscriber() -> None:
    global _subscriber_started

    if not settings.USER_PREFS_NOTIFY_ENABLED:
        log.info("user prefs notify disabled (USER_PREFS_NOTIFY_ENABLED=false)")
        return

    with _subscriber_lock:
        if _subscriber_started:
            return
        _subscriber_started = True

    thread = threading.Thread(
        target=_prefs_notify_subscriber_loop,
        name="user-prefs-notify-subscriber",
        daemon=True,
    )
    thread.start()


def reset_user_prefs_notify_subscriber_for_tests() -> None:
    global _subscriber_started
    with _subscriber_lock:
        _subscriber_started = False
