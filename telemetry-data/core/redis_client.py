"""Shared Redis client for telemetry-data."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from core import settings

if TYPE_CHECKING:
    from redis import Redis

try:
    import redis
except Exception:  # pragma: no cover
    redis = None  # type: ignore[assignment]

_client: Redis | None = None
_blocking_client: Redis | None = None
_lock = threading.Lock()


def _socket_timeout_from_sec(seconds: int) -> float | None:
    return None if seconds <= 0 else float(seconds)


def _create_redis_client(*, socket_timeout: float | None) -> Redis:
    if redis is None:
        raise RuntimeError(
            "Redis package is not installed. Run: pip install -r requirements.txt"
        )
    if not settings.REDIS_HOST:
        raise RuntimeError("REDIS_HOST is not configured")

    kwargs: dict[str, object] = {
        "host": settings.REDIS_HOST,
        "port": settings.REDIS_PORT,
        "decode_responses": True,
        "username": settings.REDIS_USERNAME,
        "password": settings.REDIS_PASSWORD,
        "db": settings.REDIS_DB,
        "ssl": settings.REDIS_SSL,
        "retry_on_timeout": True,
        "health_check_interval": settings.REDIS_HEALTH_CHECK_INTERVAL_SEC,
    }
    if socket_timeout is not None:
        kwargs["socket_timeout"] = socket_timeout
    return redis.Redis(**kwargs)


def get_redis_client() -> Redis:
    """Short-lived Redis commands (GET, SET, XADD, etc.)."""
    global _client
    if _client is not None:
        return _client
    with _lock:
        if _client is not None:
            return _client
        _client = _create_redis_client(
            socket_timeout=_socket_timeout_from_sec(settings.REDIS_SOCKET_TIMEOUT_SEC),
        )
        return _client


def get_redis_blocking_client() -> Redis:
    """Blocking reads: XREADGROUP BLOCK and pub/sub listen loops."""
    global _blocking_client
    if _blocking_client is not None:
        return _blocking_client
    with _lock:
        if _blocking_client is not None:
            return _blocking_client
        _blocking_client = _create_redis_client(
            socket_timeout=_socket_timeout_from_sec(settings.REDIS_BLOCKING_SOCKET_TIMEOUT_SEC),
        )
        return _blocking_client


def reset_client_for_tests() -> None:
    """Clear cached clients (tests only)."""
    global _client, _blocking_client
    with _lock:
        _client = None
        _blocking_client = None
