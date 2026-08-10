"""Private in-game chat when acceptBattle or saveTime pref changes (pub/sub from ac-data)."""

from __future__ import annotations

import json
import threading
from typing import Any

from core import settings
from core.logging_config import get_logger
from core.redis_pubsub_subscriber import run_pubsub_subscriber_loop
from core.steam_id_chat_notify import notify_steam_id_chat

log = get_logger("user_prefs_notify")

_subscriber_started = False
_subscriber_lock = threading.Lock()


def _message_for_pref(pref: str, enabled: bool) -> str | None:
    if pref in ("acceptBattle", "accept_battle"):
        return (
            settings.USER_PREFS_ACCEPT_BATTLE_ENABLED_MESSAGE
            if enabled
            else settings.USER_PREFS_ACCEPT_BATTLE_DISABLED_MESSAGE
        )
    if pref in ("saveTime", "save_time"):
        return (
            settings.USER_PREFS_SAVE_TIME_ENABLED_MESSAGE
            if enabled
            else settings.USER_PREFS_SAVE_TIME_DISABLED_MESSAGE
        )
    return None


def notify_pref_change(steam_id: str, pref: str, enabled: bool) -> int:
    """Send private server chat to every connected instance of steam_id."""
    if not settings.USER_PREFS_NOTIFY_ENABLED:
        return 0

    trimmed = (steam_id or "").strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return 0

    message = _message_for_pref(pref, enabled)
    if not message:
        log.warning("user prefs notify: unknown pref %r", pref)
        return 0

    return notify_steam_id_chat(trimmed, message, log_label=f"pref {pref}")


def _parse_pref_notify_message(raw: str) -> tuple[str, str, bool] | None:
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

    pref_raw = payload.get("pref")
    enabled: bool | None = None

    if isinstance(pref_raw, str) and pref_raw.strip():
        pref = pref_raw.strip()
        enabled_raw = payload.get("enabled")
        if enabled_raw is True:
            enabled = True
        elif enabled_raw is False:
            enabled = False
    elif payload.get("acceptBattle") is True or payload.get("acceptBattle") is False:
        pref = "acceptBattle"
        enabled = payload.get("acceptBattle") is True
    elif payload.get("accept_battle") is True or payload.get("accept_battle") is False:
        pref = "acceptBattle"
        enabled = payload.get("accept_battle") is True
    else:
        return None

    if enabled is None:
        return None

    return steam_raw.strip(), pref, enabled


def _handle_prefs_notify_message(raw: str) -> None:
    parsed = _parse_pref_notify_message(raw)
    if parsed is None:
        log.warning("user prefs notify: invalid payload %r", raw[:200])
        return

    steam_id, pref, enabled = parsed
    notify_pref_change(steam_id, pref, enabled)


def _prefs_notify_subscriber_loop() -> None:
    run_pubsub_subscriber_loop(
        settings.USER_PREFS_NOTIFY_CHANNEL,
        _handle_prefs_notify_message,
        log_label="user prefs notify subscriber",
    )


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
