"""Resilient Redis pub/sub subscriber loop with exponential backoff reconnect."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from core import settings
from core.logging_config import get_logger

log = get_logger("redis_pubsub_subscriber")

_INITIAL_BACKOFF_SEC = 1.0
_MAX_BACKOFF_SEC = 60.0


def run_pubsub_subscriber_loop(
    channel: str,
    handler: Callable[[str], None],
    *,
    log_label: str,
) -> None:
    """Listen on channel forever; reconnect with backoff after errors."""
    if not settings.REDIS_HOST:
        log.info("%s disabled (REDIS_HOST missing)", log_label)
        return

    backoff = _INITIAL_BACKOFF_SEC
    while True:
        try:
            from core.redis_client import get_redis_blocking_client

            redis = get_redis_blocking_client()
            pubsub = redis.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(channel)
            log.info("%s listening on %s", log_label, channel)
            backoff = _INITIAL_BACKOFF_SEC

            for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                data = message.get("data")
                if isinstance(data, bytes):
                    data = data.decode("utf-8", errors="replace")
                if isinstance(data, str):
                    handler(data)
        except Exception:
            log.exception("%s stopped; reconnecting in %.1fs", log_label, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF_SEC)


def parse_steam_id_message(raw: str) -> str | None:
    """Parse pub/sub payload `{ steamId }` or plain steam id string."""
    import json

    trimmed = raw.strip()
    if not trimmed:
        return None

    try:
        payload: Any = json.loads(trimmed)
        if isinstance(payload, dict):
            value = payload.get("steamId") or payload.get("steam_id")
            if isinstance(value, str) and value.strip():
                return value.strip()
    except (TypeError, json.JSONDecodeError):
        pass

    return trimmed
