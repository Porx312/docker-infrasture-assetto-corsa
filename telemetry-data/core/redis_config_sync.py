"""Consume ac:config snapshots and update in-memory runtime_config (modes + event rules)."""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict

from core import runtime_config, settings
from core.logging_config import get_logger
from core.redis_client import get_redis_blocking_client

log = get_logger("config_sync")

try:
    import redis.exceptions as redis_exceptions
except Exception:  # pragma: no cover
    redis_exceptions = None


def _is_transient_redis_loop_error(exc: BaseException) -> bool:
    if redis_exceptions is None:
        return False
    return isinstance(exc, (redis_exceptions.TimeoutError, redis_exceptions.ConnectionError))

_versions_lock = threading.Lock()


def _versions_file_path() -> str:
    return settings.REDIS_APPLIED_CONFIG_VERSIONS_FILE


def _load_versions() -> Dict[str, str]:
    path = _versions_file_path()
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_versions(data: Dict[str, str]) -> None:
    path = _versions_file_path()
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.warning("could not save versions file: %s", e)


def apply_snapshot(servers: Dict[int, Any], payload: Dict[str, Any]) -> tuple[int, int]:
    """
    Apply a server_config_snapshot payload.

    Updates runtime_config (modes + event constraints) only. INI writes are owned by ac-data.
    """
    del servers  # kept for call-site compatibility
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return 0, 0
    instance_id = str(data.get("instanceId") or payload.get("instanceId") or "")
    version = str(data.get("version") or "")
    if instance_id != settings.AC_INSTANCE_ID or not version:
        return 0, 0

    rows = data.get("servers") or []
    if not isinstance(rows, list):
        rows = []

    runtime_config.set_server_modes(rows)
    log.info(
        "runtime_config modes updated version=%s count=%d map=%s",
        version,
        len(rows),
        runtime_config.snapshot(),
    )

    with _versions_lock:
        versions = _load_versions()
        if versions.get(instance_id) == version:
            return 0, 0
        versions[instance_id] = version
        _save_versions(versions)

    log.info(
        "runtime_config updated version=%s servers=%d",
        version,
        len(rows),
    )
    return len(rows), 0


def bootstrap_runtime_config_from_stream(client) -> bool:
    """
    On cold start the consumer group only reads '>' (new) messages, so modes would
    stay empty until Convex publishes again. Load the latest snapshot from the stream.
    """
    try:
        entries = client.xrevrange(settings.REDIS_CONFIG_STREAM_KEY, count=100)
    except Exception as exc:
        log.warning("bootstrap xrevrange failed: %s", exc)
        return False

    for msg_id, fields in entries:
        raw_payload = fields.get("payload")
        if not raw_payload:
            continue
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            continue
        if payload.get("event") != "server_config_snapshot":
            continue
        data = payload.get("data") or {}
        if not isinstance(data, dict):
            continue
        instance_id = str(data.get("instanceId") or payload.get("instanceId") or "")
        if instance_id != settings.AC_INSTANCE_ID:
            continue
        rows = data.get("servers") or []
        if not isinstance(rows, list):
            rows = []
        runtime_config.set_server_modes(rows)
        log.info(
            "bootstrapped runtime_config from stream id=%s version=%s modes=%s",
            msg_id,
            data.get("version"),
            runtime_config.snapshot(),
        )
        return True

    log.warning(
        "no server_config_snapshot in stream for instance %s; "
        "battle/time-attack modes stay unknown until ac-data publishes to ac:config",
        settings.AC_INSTANCE_ID,
    )
    return False


def start_redis_config_consumer(servers: Dict[int, Any]) -> None:
    if not settings.REDIS_CONFIG_CONSUMER_ENABLED:
        log.info("disabled by REDIS_CONFIG_CONSUMER_ENABLED")
        return
    if not settings.REDIS_HOST:
        log.warning("REDIS_HOST missing, consumer disabled")
        return

    client = get_redis_blocking_client()
    try:
        client.xgroup_create(
            settings.REDIS_CONFIG_STREAM_KEY,
            settings.REDIS_CONFIG_CONSUMER_GROUP,
            id="0",
            mkstream=True,
        )
    except Exception:
        pass

    if not runtime_config.has_data():
        bootstrap_runtime_config_from_stream(client)

    log.info(
        "listening stream=%s group=%s consumer=%s instance=%s modes_loaded=%s",
        settings.REDIS_CONFIG_STREAM_KEY,
        settings.REDIS_CONFIG_CONSUMER_GROUP,
        settings.REDIS_CONFIG_CONSUMER_NAME,
        settings.AC_INSTANCE_ID,
        runtime_config.has_data(),
    )
    while True:
        try:
            res = client.xreadgroup(
                settings.REDIS_CONFIG_CONSUMER_GROUP,
                settings.REDIS_CONFIG_CONSUMER_NAME,
                {settings.REDIS_CONFIG_STREAM_KEY: ">"},
                count=25,
                block=settings.REDIS_CONFIG_XREAD_BLOCK_MS,
            )
            if not res:
                continue
            for _stream, messages in res:
                for msg_id, fields in messages:
                    try:
                        raw_payload = fields.get("payload")
                        if not raw_payload:
                            client.xack(
                                settings.REDIS_CONFIG_STREAM_KEY,
                                settings.REDIS_CONFIG_CONSUMER_GROUP,
                                msg_id,
                            )
                            continue
                        payload = json.loads(raw_payload)
                        if payload.get("event") != "server_config_snapshot":
                            client.xack(
                                settings.REDIS_CONFIG_STREAM_KEY,
                                settings.REDIS_CONFIG_CONSUMER_GROUP,
                                msg_id,
                            )
                            continue
                        applied, errors = apply_snapshot(servers, payload)
                        if applied or errors:
                            log.info(
                                "processed snapshot version=%s applied=%d errors=%d",
                                (payload.get("data") or {}).get("version"),
                                applied,
                                errors,
                            )
                        client.xack(
                            settings.REDIS_CONFIG_STREAM_KEY,
                            settings.REDIS_CONFIG_CONSUMER_GROUP,
                            msg_id,
                        )
                    except Exception as e:
                        log.exception("message error: %s", e)
        except Exception as e:
            if _is_transient_redis_loop_error(e):
                log.warning("redis transient error in config consumer (%s); retrying", e)
            else:
                log.exception("loop error: %s", e)
            time.sleep(1)
