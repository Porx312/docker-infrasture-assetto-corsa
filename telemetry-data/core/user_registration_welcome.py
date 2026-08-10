"""Private in-game chat when Steam registration clears mid-session."""

from __future__ import annotations

import json
import threading
from typing import Any

from core import settings
from core.logging_config import get_logger
from core.server_registry import find_driver_by_steam_id
from core.session_manager import send_chat

log = get_logger("user_registration_welcome")

_subscriber_started = False
_subscriber_lock = threading.Lock()


def notify_registered_welcome(steam_id: str) -> int:
    if not settings.USER_REGISTERED_WELCOME_ENABLED:
        return 0

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return 0

    message = settings.USER_REGISTERED_WELCOME_MESSAGE
    matches = find_driver_by_steam_id(trimmed)
    sent = 0

    for server_state, driver in matches:
        car_id = driver.car_id
        if car_id is None or not server_state.last_server_addr:
            continue
        send_chat(server_state, car_id, message)
        sent += 1
        log.info(
            "[%s] registration welcome chat steamId=%s car=%s",
            server_state.port,
            trimmed,
            car_id,
        )

    if sent == 0:
        log.info(
            "registration welcome chat: steamId=%s but no active driver with car_id",
            trimmed,
        )

    return sent


def _parse_registered_message(raw: str) -> str | None:
    trimmed = raw.strip()
    if not trimmed:
        return None

    try:
        payload: Any = json.loads(trimmed)
    except (TypeError, json.JSONDecodeError):
        return trimmed

    if isinstance(payload, dict):
        value = payload.get("steamId") or payload.get("steam_id")
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def _handle_registered_message(raw: str) -> None:
    steam_id = _parse_registered_message(raw)
    if not steam_id:
        log.warning("registration welcome: invalid payload %r", raw[:200])
        return
    notify_registered_welcome(steam_id)


def _registered_welcome_subscriber_loop() -> None:
    if not settings.REDIS_HOST:
        log.info("registration welcome subscriber disabled (REDIS_HOST missing)")
        return

    try:
        from core.redis_client import get_redis_blocking_client

        redis = get_redis_blocking_client()
        pubsub = redis.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(settings.USER_REGISTERED_CHANNEL)
        log.info(
            "registration welcome subscriber listening on %s",
            settings.USER_REGISTERED_CHANNEL,
        )

        for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            data = message.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            if isinstance(data, str):
                _handle_registered_message(data)
    except Exception:
        log.exception("registration welcome subscriber stopped")


def start_user_registered_welcome_subscriber() -> None:
    global _subscriber_started

    if not settings.USER_REGISTERED_WELCOME_ENABLED:
        log.info("registration welcome disabled (USER_REGISTERED_WELCOME_ENABLED=false)")
        return

    with _subscriber_lock:
        if _subscriber_started:
            return
        _subscriber_started = True

    thread = threading.Thread(
        target=_registered_welcome_subscriber_loop,
        name="user-registered-welcome-subscriber",
        daemon=True,
    )
    thread.start()


def reset_user_registered_welcome_subscriber_for_tests() -> None:
    global _subscriber_started
    with _subscriber_lock:
        _subscriber_started = False
