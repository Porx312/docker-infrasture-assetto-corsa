"""
event_dispatcher.py
====================
Publishes runtime telemetry / battle events to the Redis Stream consumed by
the `ac-data` bridge, which forwards them to Convex.
"""

from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from core import settings
from core.logging_config import get_logger
from core.cm_name import display_server_name, strip_cm_name_suffix
from core.redis_client import get_redis_client

log = get_logger("event_dispatcher")

_publish_queue: queue.Queue[tuple[str, str, dict] | None] | None = None
_executor: ThreadPoolExecutor | None = None
_started = False
_start_lock = threading.Lock()


def _ensure_publish_worker() -> None:
    global _publish_queue, _executor, _started
    with _start_lock:
        if _started:
            return
        _publish_queue = queue.Queue(maxsize=settings.REDIS_PUBLISH_QUEUE_SIZE)
        _executor = ThreadPoolExecutor(
            max_workers=max(1, settings.REDIS_PUBLISH_WORKERS),
            thread_name_prefix="redis-publish",
        )

        def _worker() -> None:
            assert _publish_queue is not None
            while True:
                item = _publish_queue.get()
                if item is None:
                    _publish_queue.task_done()
                    break
                event_type, server_name, data = item
                try:
                    _publish_redis_event(event_type, server_name, data)
                except Exception as exc:  # noqa: BLE001
                    log.error("dispatch %s failed: %s", event_type, exc)
                finally:
                    _publish_queue.task_done()

        for _ in range(max(1, settings.REDIS_PUBLISH_WORKERS)):
            _executor.submit(_worker)
        _started = True


def _publish_redis_event(event_type: str, server_name: str, data: dict) -> None:
    client = get_redis_client()
    event_id = str(uuid.uuid4())
    envelope = {
        "eventId": event_id,
        "schemaVersion": settings.REDIS_SCHEMA_VERSION,
        "event": event_type,
        "serverName": server_name,
        "instanceId": settings.AC_INSTANCE_ID,
        "ts": int(time.time() * 1000),
        "data": data,
    }
    fields = {
        "event": event_type,
        "eventId": event_id,
        "schemaVersion": settings.REDIS_SCHEMA_VERSION,
        "instanceId": settings.AC_INSTANCE_ID,
        "serverName": str(server_name or ""),
        "ts": str(envelope["ts"]),
        "payload": json.dumps(envelope, separators=(",", ":"), ensure_ascii=False),
    }
    client.xadd(
        settings.REDIS_STREAM_KEY,
        fields,
        maxlen=settings.REDIS_STREAM_MAXLEN,
        approximate=True,
    )


def build_envelope(event_type: str, server_name: str, data: dict) -> dict:
    """Build the Redis envelope dict (for tests and diagnostics)."""
    event_id = str(uuid.uuid4())
    return {
        "eventId": event_id,
        "schemaVersion": settings.REDIS_SCHEMA_VERSION,
        "event": event_type,
        "serverName": server_name,
        "instanceId": settings.AC_INSTANCE_ID,
        "ts": int(time.time() * 1000),
        "data": data,
    }


def _enqueue(event_type: str, server_name: str, data: dict) -> None:
    _ensure_publish_worker()
    assert _publish_queue is not None
    try:
        _publish_queue.put_nowait((event_type, server_name, data))
    except queue.Full:
        log.error("publish queue full, dropping event %s", event_type)


def send_server_event(event_type: str, server_name: str, data: dict) -> None:
    """Publish a generic server event into the Redis stream (non-blocking)."""
    _enqueue(event_type, strip_cm_name_suffix(server_name), data)


def dispatch_battle_webhook(
    server_state,
    battle_config: dict,
    p1_score: int,
    p2_score: int,
    winner_guid: str | None,
    points_log,
    *,
    status: str | None = None,
) -> None:
    """Publish battle_update / battle_finished events."""
    meta = battle_config.get("metadata", {}) or {}
    if status is None:
        status = "finished" if winner_guid is not None else "draw"
    payload = {
        "battleId": battle_config.get("battle_id"),
        "player1SteamId": battle_config.get("player1_steam_id"),
        "player2SteamId": battle_config.get("player2_steam_id"),
        "player1Score": p1_score,
        "player2Score": p2_score,
        "player1Car": meta.get("player1Car", ""),
        "player2Car": meta.get("player2Car", ""),
        "player1Name": meta.get("player1Name", ""),
        "player2Name": meta.get("player2Name", ""),
        "pointsLog": points_log or [],
        "status": status,
        "serverName": display_server_name(server_state),
        "track": meta.get("track", ""),
        "trackConfig": meta.get("trackConfig", ""),
    }
    if winner_guid:
        payload["winnerSteamId"] = winner_guid

    server_name = display_server_name(server_state)
    _enqueue("battle_update", server_name, payload)
    log.info(
        "battle_update battleId=%s status=%s score=%s-%s",
        payload.get("battleId"),
        payload.get("status"),
        payload.get("player1Score"),
        payload.get("player2Score"),
    )
    if payload.get("status") in ("finished", "draw"):
        _enqueue("battle_finished", server_name, payload)
        log.info(
            "battle_finished battleId=%s winner=%s status=%s",
            payload.get("battleId"),
            winner_guid,
            payload.get("status"),
        )


def shutdown_publish_workers() -> None:
    """Drain and stop publish workers (tests / graceful shutdown)."""
    global _started, _publish_queue, _executor
    with _start_lock:
        if not _started or _publish_queue is None or _executor is None:
            return
        for _ in range(max(1, settings.REDIS_PUBLISH_WORKERS)):
            _publish_queue.put(None)
        _executor.shutdown(wait=True, cancel_futures=False)
        _started = False
        _publish_queue = None
        _executor = None
