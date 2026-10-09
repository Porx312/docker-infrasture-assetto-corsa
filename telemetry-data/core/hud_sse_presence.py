"""Check overlay WS presence in Redis (written by ac-data-edge on /hud/ws connect).

Primary key: ac:hud:conn:{steamId}
Legacy fallback: ac:hud:sse:{steamId} (pre-WS dual-write era).
"""

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


def hud_conn_redis_key(steam_id: str) -> str:
    trimmed = steam_id.strip()
    return f"{settings.HUD_CONN_REDIS_PREFIX}{trimmed}"


def hud_sse_redis_key(steam_id: str) -> str:
    """Legacy SSE key — kept for fallback reads during migration."""
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
        if redis.exists(hud_conn_redis_key(trimmed)):
            return True
        return bool(redis.exists(hud_sse_redis_key(trimmed)))
    except Exception as exc:
        log.warning("hud conn presence check failed for %s: %s", trimmed, exc)
        return False


def _cached_overlay_active(steam_id: str) -> bool:
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


def has_hud_overlay_connected(steam_id: str) -> bool:
    """True when overlay presence exists — always reads Redis (chat routing)."""
    return _cached_overlay_active(steam_id)


def is_hud_sse_active(steam_id: str) -> bool:
    """Return True when overlay is connected (conn key, else legacy sse)."""
    if not settings.BATTLE_REQUIRE_HUD_SSE:
        return True
    return _cached_overlay_active(steam_id)


def filter_hud_eligible(guids: Iterable[str]) -> set[str]:
    """Batch filter: guids with active HUD overlay (MGET when Redis available)."""
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
            conn_keys = [hud_conn_redis_key(g) for g in pending]
            conn_values = redis.mget(conn_keys)
            still_missing = [
                g for g, value in zip(pending, conn_values, strict=True) if value is None
            ]
            sse_active: dict[str, bool] = {}
            if still_missing:
                sse_keys = [hud_sse_redis_key(g) for g in still_missing]
                sse_values = redis.mget(sse_keys)
                for guid, value in zip(still_missing, sse_values, strict=True):
                    sse_active[guid] = value is not None
            with _cache_lock:
                for guid, value in zip(pending, conn_values, strict=True):
                    if value is not None:
                        _cache[guid] = (True, now)
                    else:
                        _cache[guid] = (sse_active.get(guid, False), now)
        except Exception as exc:
            log.warning("hud conn batch check failed: %s", exc)
            for guid in pending:
                active = _read_active_from_redis(guid)
                with _cache_lock:
                    _cache[guid] = (active, time.time())

    with _cache_lock:
        return {g for g in unique if _cache.get(g, (False, 0.0))[0]}


def reset_hud_sse_presence_cache_for_tests() -> None:
    with _cache_lock:
        _cache.clear()
