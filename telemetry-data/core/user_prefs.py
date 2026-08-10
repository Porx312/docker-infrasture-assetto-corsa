"""User profile prefs mirrored from Convex via ac-data on player_join."""

from __future__ import annotations

import threading
import time
from typing import Iterable

from core import settings
from core.logging_config import get_logger

log = get_logger("user_prefs")

_CACHE_TTL_SEC = 2.0
_cache_lock = threading.Lock()
_cache: dict[str, tuple[bool, float]] = {}

PREFS_DISABLED_VALUE = "0"


def save_time_redis_key(steam_id: str) -> str:
    trimmed = steam_id.strip()
    return f"{settings.USER_PREFS_SAVE_TIME_PREFIX}{trimmed}"


def accept_battle_redis_key(steam_id: str) -> str:
    trimmed = steam_id.strip()
    return f"{settings.USER_PREFS_ACCEPT_BATTLE_PREFIX}{trimmed}"


def _read_pref_enabled(key: str) -> bool:
    if not settings.REDIS_HOST:
        return True
    try:
        from core.redis_client import get_redis_client

        redis = get_redis_client()
        value = redis.get(key)
        if value is None:
            return True
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="replace")
        return str(value).strip() != PREFS_DISABLED_VALUE
    except Exception as exc:
        log.warning("user pref check failed for %s: %s", key, exc)
        return True


def is_steam_id_battle_eligible(steam_id: str) -> bool:
    """True when acceptBattle is not explicitly false (default opt-out true)."""
    trimmed = steam_id.strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return True
    return _read_pref_enabled(accept_battle_redis_key(trimmed))


def filter_battle_accept_eligible(guids: Iterable[str]) -> set[str]:
    """Batch filter: guids that accept battle matchmaking (MGET when Redis available)."""
    unique = []
    seen: set[str] = set()
    for guid in guids:
        trimmed = guid.strip()
        if not trimmed or trimmed.startswith("unknown_") or trimmed in seen:
            continue
        seen.add(trimmed)
        unique.append(trimmed)

    if not unique:
        return set()

    if not settings.REDIS_HOST:
        return set(unique)

    now = time.time()
    with _cache_lock:
        pending = [g for g in unique if g not in _cache or (now - _cache[g][1]) >= _CACHE_TTL_SEC]

    if pending:
        try:
            from core.redis_client import get_redis_client

            redis = get_redis_client()
            keys = [accept_battle_redis_key(g) for g in pending]
            values = redis.mget(keys)
            with _cache_lock:
                for guid, value in zip(pending, values, strict=True):
                    if value is None:
                        eligible = True
                    elif isinstance(value, bytes):
                        eligible = value.decode("utf-8", errors="replace").strip() != PREFS_DISABLED_VALUE
                    else:
                        eligible = str(value).strip() != PREFS_DISABLED_VALUE
                    _cache[guid] = (eligible, now)
        except Exception as exc:
            log.warning("user prefs batch check failed: %s", exc)
            for guid in pending:
                eligible = is_steam_id_battle_eligible(guid)
                with _cache_lock:
                    _cache[guid] = (eligible, time.time())

    with _cache_lock:
        return {g for g in unique if _cache.get(g, (True, 0.0))[0]}


def reset_user_prefs_cache_for_tests() -> None:
    with _cache_lock:
        _cache.clear()
