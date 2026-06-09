"""Consume ac:config snapshots and update in-memory runtime_config (modes + event rules)."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, Optional

from core import runtime_config, settings
from core.logging_config import get_logger
from core.redis_client import get_redis_client
from core.cm_name import display_server_name, strip_cm_name_suffix
from network.event_dispatcher import send_server_event

log = get_logger("config_sync")

_VERSIONS_FILE = os.path.join(os.getcwd(), "redis_applied_config_versions.json")
_versions_lock = threading.Lock()


def _load_versions() -> Dict[str, str]:
    try:
        if os.path.exists(_VERSIONS_FILE):
            with open(_VERSIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_versions(data: Dict[str, str]) -> None:
    try:
        with open(_VERSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.warning("could not save versions file: %s", e)


def _normalize_track_config_for_ini(value: Any) -> Optional[str]:
    """Empty CONFIG_TRACK means the track's built-in default layout; never write literal 'default'."""
    if value is None:
        return None
    text = str(value).strip()
    if text == "" or text.lower() == "default":
        return ""
    return text


def _replace_or_append(content: str, key: str, value: str) -> str:
    line = f"{key}={value}"
    pattern = rf"(?m)^{re.escape(key)}=.*$"
    if re.search(pattern, content):
        return re.sub(pattern, line, content)
    return content.rstrip() + f"\n{line}\n"


def _write_server_cfg(cfg_path: str, cfg: Dict[str, Any]) -> list[str]:
    with open(cfg_path, "rb") as f:
        raw = f.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("utf-16le", errors="ignore")

    changed: list[str] = []
    mappings = [
        ("NAME", cfg.get("displayName")),
        ("PASSWORD", cfg.get("password")),
        ("TRACK", cfg.get("track")),
        ("CONFIG_TRACK", _normalize_track_config_for_ini(cfg.get("trackConfig"))),
        ("MAX_CLIENTS", cfg.get("maxClients")),
    ]
    for key, value in mappings:
        if value is None:
            continue
        next_content = _replace_or_append(content, key, str(value))
        if next_content != content:
            changed.append(key)
            content = next_content

    entries = cfg.get("entries")
    if isinstance(entries, list):
        car_models = []
        for entry in entries:
            model = str((entry or {}).get("model") or "").strip()
            if not model:
                continue
            count = int((entry or {}).get("count") or 1)
            for _ in range(max(1, count)):
                car_models.append(model)
        if car_models:
            cars_value = ";".join(sorted(set(car_models)))
            next_content = _replace_or_append(content, "CARS", cars_value)
            if next_content != content:
                changed.append("CARS")
                content = next_content

    with open(cfg_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return changed


def _write_entry_list(cfg_path: str, cfg: Dict[str, Any]) -> bool:
    entries = cfg.get("entries")
    if not isinstance(entries, list):
        return False
    cfg_dir = os.path.dirname(cfg_path)
    entry_list_path = os.path.join(cfg_dir, "entry_list.ini")

    blocks = []
    idx = 0
    for entry in entries:
        model = str((entry or {}).get("model") or "").strip()
        if not model:
            continue
        skin = str((entry or {}).get("skin") or "0_default")
        count = int((entry or {}).get("count") or 1)
        for _ in range(max(1, count)):
            blocks.append(
                "\n".join(
                    [
                        f"[CAR_{idx}]",
                        f"MODEL={model}",
                        f"SKIN={skin}",
                        "SPECTATOR_MODE=0",
                        "DRIVERNAME=",
                        "TEAM=",
                        "GUID=",
                        "BALLAST=0",
                        "RESTRICTOR=0",
                        "",
                    ]
                )
            )
            idx += 1

    with open(entry_list_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(blocks).rstrip() + "\n")
    return True


def _find_state_by_server_name(
    servers: Dict[int, Any], server_name: str, display_name: str = ""
) -> Optional[Any]:
    targets = []
    for value in (server_name, display_name):
        text = strip_cm_name_suffix((value or "").strip()).lower()
        if text and text not in targets:
            targets.append(text)
    if not targets:
        return None
    for state in servers.values():
        candidates = [
            (getattr(state, "server_folder_id", "") or "").strip().lower(),
            strip_cm_name_suffix(
                (getattr(state, "config_server_name", "") or "").strip()
            ).lower(),
            strip_cm_name_suffix(
                (getattr(state, "server_name", "") or "").strip()
            ).lower(),
        ]
        for target in targets:
            if target in candidates:
                return state
    return None


def apply_snapshot(servers: Dict[int, Any], payload: Dict[str, Any]) -> tuple[int, int]:
    """
    Apply a server_config_snapshot payload.

    Always updates runtime_config (modes + event constraints).
    Writes INI files only when REDIS_CONFIG_INI_WRITE_ENABLED=true (legacy).
    """
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

    if not settings.REDIS_CONFIG_INI_WRITE_ENABLED:
        with _versions_lock:
            versions = _load_versions()
            versions[instance_id] = version
            _save_versions(versions)
        log.info(
            "runtime_config updated version=%s servers=%d (ini write disabled)",
            version,
            len(rows),
        )
        return len(rows), 0

    applied = 0
    errors = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        state = _find_state_by_server_name(
            servers,
            str(row.get("serverName") or ""),
            str(row.get("displayName") or ""),
        )
        if not state or not getattr(state, "cfg_path", None):
            continue
        server_label = display_server_name(state) or "unknown"
        try:
            changed = _write_server_cfg(state.cfg_path, row)
            entry_written = _write_entry_list(state.cfg_path, row)
            applied += 1
            send_server_event(
                "server_config_applied",
                server_label,
                {
                    "instanceId": settings.AC_INSTANCE_ID,
                    "version": version,
                    "serverName": row.get("serverName"),
                    "updatedKeys": changed,
                    "entryListUpdated": entry_written,
                    "ok": True,
                },
            )
        except Exception as e:
            errors += 1
            send_server_event(
                "server_config_applied",
                server_label,
                {
                    "instanceId": settings.AC_INSTANCE_ID,
                    "version": version,
                    "serverName": row.get("serverName"),
                    "ok": False,
                    "error": str(e),
                },
            )

    if applied > 0 and errors == 0:
        with _versions_lock:
            versions = _load_versions()
            versions[instance_id] = version
            _save_versions(versions)
    return applied, errors


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

    client = get_redis_client()
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
        "listening stream=%s group=%s consumer=%s instance=%s ini_write=%s modes_loaded=%s",
        settings.REDIS_CONFIG_STREAM_KEY,
        settings.REDIS_CONFIG_CONSUMER_GROUP,
        settings.REDIS_CONFIG_CONSUMER_NAME,
        settings.AC_INSTANCE_ID,
        settings.REDIS_CONFIG_INI_WRITE_ENABLED,
        runtime_config.has_data(),
    )
    while True:
        try:
            res = client.xreadgroup(
                settings.REDIS_CONFIG_CONSUMER_GROUP,
                settings.REDIS_CONFIG_CONSUMER_NAME,
                {settings.REDIS_CONFIG_STREAM_KEY: ">"},
                count=25,
                block=5000,
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
            log.exception("loop error: %s", e)
            time.sleep(1)
