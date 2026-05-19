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
_lock = threading.Lock()


def get_redis_client() -> Redis:
    global _client
    if redis is None:
        raise RuntimeError(
            "Redis package is not installed. Run: pip install -r requirements.txt"
        )
    if _client is not None:
        return _client
    with _lock:
        if _client is not None:
            return _client
        if not settings.REDIS_HOST:
            raise RuntimeError("REDIS_HOST is not configured")
        _client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True,
            username=settings.REDIS_USERNAME,
            password=settings.REDIS_PASSWORD,
            db=settings.REDIS_DB,
            ssl=settings.REDIS_SSL,
        )
        return _client


def reset_client_for_tests() -> None:
    """Clear cached client (tests only)."""
    global _client
    with _lock:
        _client = None
