"""Short TTL cache for Redis user-status flags (ban / registration checks on CAR_UPDATE)."""

from __future__ import annotations

import threading
import time

_CACHE_TTL_SEC = 2.0
_cache_lock = threading.Lock()
_banned_cache: dict[str, tuple[bool, float]] = {}
_not_registered_cache: dict[str, tuple[bool, float]] = {}


def _read_cached(
    cache: dict[str, tuple[bool, float]],
    steam_id: str,
    *,
    now: float | None = None,
) -> bool | None:
    ts = now if now is not None else time.time()
    with _cache_lock:
        entry = cache.get(steam_id)
        if entry is None:
            return None
        value, cached_at = entry
        if (ts - cached_at) >= _CACHE_TTL_SEC:
            return None
        return value


def _write_cached(cache: dict[str, tuple[bool, float]], steam_id: str, value: bool, *, now: float | None = None) -> None:
    ts = now if now is not None else time.time()
    with _cache_lock:
        cache[steam_id] = (value, ts)


def read_banned_cached(steam_id: str) -> bool | None:
    return _read_cached(_banned_cache, steam_id)


def write_banned_cached(steam_id: str, value: bool) -> None:
    _write_cached(_banned_cache, steam_id, value)


def read_not_registered_cached(steam_id: str) -> bool | None:
    return _read_cached(_not_registered_cache, steam_id)


def write_not_registered_cached(steam_id: str, value: bool) -> None:
    _write_cached(_not_registered_cache, steam_id, value)


def reset_user_status_cache_for_tests() -> None:
    with _cache_lock:
        _banned_cache.clear()
        _not_registered_cache.clear()
