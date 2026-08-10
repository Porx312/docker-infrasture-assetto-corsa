"""Private in-game chat when Steam registration clears mid-session."""

from __future__ import annotations

import json
import threading
from typing import Any

from core import settings
from core.logging_config import get_logger
from core.redis_pubsub_subscriber import run_pubsub_subscriber_loop
from core.steam_id_chat_notify import notify_steam_id_chat

log = get_logger("user_registration_welcome")

_subscriber_started = False
_subscriber_lock = threading.Lock()


def notify_registered_welcome(steam_id: str) -> int:
    if not settings.USER_REGISTERED_WELCOME_ENABLED:
        return 0

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return 0

    return notify_steam_id_chat(
        trimmed,
        settings.USER_REGISTERED_WELCOME_MESSAGE,
        log_label="registration welcome",
    )


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
    run_pubsub_subscriber_loop(
        settings.USER_REGISTERED_CHANNEL,
        _handle_registered_message,
        log_label="registration welcome subscriber",
    )


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
