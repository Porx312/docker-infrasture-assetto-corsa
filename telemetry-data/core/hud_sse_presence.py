"""Check overlay SSE presence in Redis (written by ac-data on /hud/stream connect)."""

from __future__ import annotations

import threading
import time
from typing import Iterable

from core import settings
from core.logging_config import get_logger

log = get_logger("hud_sse_presence")

_CACHE_TTL_SEC = 2.0
_cache_lock = threading.Lock()
_cache: dict[str, tuple[bool, float]] = {}


def hud_sse_redis_key(steam_id: str) -> str:
    trimmed = steam_id.strip()
    return f"{settings.HUD_SSE_REDIS_PREFIX}{trimmed}"


def _read_active_from_redis(steam_id: str) -> bool:
    if not settings.REDIS_HOST:
        return False
    trimmed = steam_id.strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return False
    try:
        from core.redis_client import get_redis_client

        redis = get_redis_client()
        return bool(redis.exists(hud_sse_redis_key(trimmed)))
    except Exception as exc:
        log.warning("hud sse presence check failed for %s: %s", trimmed, exc)
        return False


def is_hud_sse_active(steam_id: str) -> bool:
    """Return True when ac:hud:sse:{steamId} exists (overlay connected)."""
    if not settings.BATTLE_REQUIRE_HUD_SSE:
        return True

    trimmed = steam_id.strip()
    if not trimmed or trimmed.startswith("unknown_"):
        return False

    now = time.time()
    with _cache_lock:
        cached = _cache.get(trimmed)
        if cached and (now - cached[1]) < _CACHE_TTL_SEC:
            return cached[0]

    active = _read_active_from_redis(trimmed)
    with _cache_lock:
        _cache[trimmed] = (active, now)
    return active


def filter_hud_eligible(guids: Iterable[str]) -> set[str]:
    """Batch filter: guids with active HUD SSE (MGET when Redis available)."""
    if not settings.BATTLE_REQUIRE_HUD_SSE:
        return set(guids)

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
        return set()

    now = time.time()
    with _cache_lock:
        pending = [g for g in unique if g not in _cache or (now - _cache[g][1]) >= _CACHE_TTL_SEC]

    if pending:
        try:
            from core.redis_client import get_redis_client

            redis = get_redis_client()
            keys = [hud_sse_redis_key(g) for g in pending]
            values = redis.mget(keys)
            with _cache_lock:
                for guid, value in zip(pending, values, strict=True):
                    _cache[guid] = (value is not None, now)
        except Exception as exc:
            log.warning("hud sse batch check failed: %s", exc)
            for guid in pending:
                active = _read_active_from_redis(guid)
                with _cache_lock:
                    _cache[guid] = (active, time.time())

    with _cache_lock:
        return {g for g in unique if _cache.get(g, (False, 0.0))[0]}


def reset_hud_sse_presence_cache_for_tests() -> None:
    with _cache_lock:
        _cache.clear()
