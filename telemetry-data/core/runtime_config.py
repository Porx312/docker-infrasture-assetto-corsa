"""
runtime_config.py
==================
In-memory cache of per-server runtime configuration sourced from the Redis
config stream (`server_config_snapshot`). Replaces the legacy SQL-based
`get_server_mode_for_instance` / `get_active_server_event` lookups.

The Redis snapshot publisher (Node bridge) sends one envelope per change of
config in Convex; our consumer in `core/redis_config_sync.py` calls
`set_server_modes(...)` so the rest of the script can resolve server modes
without touching any database.
"""

from __future__ import annotations

import threading
from typing import Any, Iterable, Mapping, Optional

from core.logging_config import get_logger

_log = get_logger("runtime_config")


_lock = threading.Lock()
_modes: dict[str, str] = {}
_event_constraints: dict[str, dict] = {}


def _normalize_mode(value: object) -> str:
    text = (str(value) if value is not None else "").strip().lower()
    text = text.replace("_", "-")
    if text in {"battle", "time-attack", "event"}:
        return text
    return ""


def _extract_event_constraints(row: dict) -> dict:
    """Build TimeAttackEngine meta from snapshot row fields."""
    constraints = row.get("eventConstraints") or row.get("event_constraints") or {}
    if not isinstance(constraints, dict):
        constraints = {}
    meta: dict = {}
    for key in ("enableCollisions", "detectIdle"):
        if key in constraints:
            meta[key] = bool(constraints[key])
        elif key in row:
            meta[key] = bool(row[key])
    if "maxFails" in constraints:
        meta["maxFails"] = constraints["maxFails"]
    elif "maxFails" in row:
        meta["maxFails"] = row["maxFails"]
    return meta


def set_server_modes(rows: Iterable[dict]) -> None:
    """
    Replace the server mode mapping with values derived from a snapshot row list.

    Each row may contain `serverName` (folder slug, e.g. "server-2"),
    `displayName` (the AC SERVER_NAME), and `type` (battle | time-attack | event).
    All keys are lowercased to make lookups case-insensitive.
    """
    new_map: dict[str, str] = {}
    new_constraints: dict[str, dict] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        mode = _normalize_mode(row.get("type"))
        event_meta = _extract_event_constraints(row)
        keys_for_row: list[str] = []
        for key in ("serverName", "displayName"):
            value = row.get(key)
            if not value:
                continue
            keys_for_row.append(str(value).strip().lower())
        if mode:
            for k in keys_for_row:
                new_map[k] = mode
        if event_meta:
            for k in keys_for_row:
                new_constraints[k] = dict(event_meta)
    with _lock:
        _modes.clear()
        _modes.update(new_map)
        _event_constraints.clear()
        _event_constraints.update(new_constraints)


def _lookup_keys(state) -> tuple[str, ...]:
    from core.cm_name import strip_cm_name_suffix

    return (
        (getattr(state, "server_folder_id", "") or "").strip().lower(),
        strip_cm_name_suffix(
            (getattr(state, "config_server_name", "") or "").strip()
        ).lower(),
        strip_cm_name_suffix((getattr(state, "server_name", "") or "").strip()).lower(),
    )


def get_mode_for_state(state) -> Optional[str]:
    """
    Resolve the active mode for a `ServerState`. Tries (in order) folder id,
    .ini server name, and the runtime server name reported by Assetto Corsa.
    Returns ``None`` when the snapshot has not yet been received.
    """
    with _lock:
        if not _modes:
            return None
        for key in _lookup_keys(state):
            if key and key in _modes:
                return _modes[key]
    return None


def get_event_constraints_for_state(state) -> dict:
    """Event / time-attack constraint flags from the latest config snapshot."""
    with _lock:
        for key in _lookup_keys(state):
            if key and key in _event_constraints:
                return dict(_event_constraints[key])
    return {}


def has_data() -> bool:
    """True when at least one snapshot has populated the cache."""
    with _lock:
        return bool(_modes)


def snapshot() -> dict[str, str]:
    """Return a shallow copy of the current mode map (for diagnostics)."""
    with _lock:
        return dict(_modes)


def log_listener_modes(servers: Mapping[int, Any]) -> None:
    """Log port → folder_id → mode for each configured listener (startup diagnostics)."""
    modes = snapshot()
    for port in sorted(servers):
        state = servers[port]
        folder_id = (getattr(state, "server_folder_id", "") or "").strip() or "?"
        mode = get_mode_for_state(state)
        cfg_path = getattr(state, "cfg_path", "") or ""
        if mode:
            _log.info(
                "listener mapping port=%s folder=%s mode=%s display=%s cfg=%s",
                port,
                folder_id,
                mode,
                getattr(state, "config_server_name", ""),
                cfg_path,
            )
        else:
            _log.warning(
                "listener mapping port=%s folder=%s mode=(none) display=%s cfg=%s; "
                "convex keys=%s",
                port,
                folder_id,
                getattr(state, "config_server_name", ""),
                cfg_path,
                sorted(modes.keys()) if modes else [],
            )
