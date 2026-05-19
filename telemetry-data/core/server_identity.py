"""Derive canonical server folder ids (server-1, server-2, ...) from cfg paths."""

from __future__ import annotations

import os
import re
from pathlib import Path

_SERVER_NUM_PATTERN = re.compile(r"(server-\d+)", re.IGNORECASE)


def derive_server_folder_id(cfg_path: str | None) -> str:
    """
    Return the folder slug used in Convex ``serverName`` (e.g. server-2).

    Examples:
      .../server/server-2/cfg/server_cfg.ini -> server-2
      .../server/cfg/server_cfg.ini         -> server
      .../server/server_cfg.ini             -> server  (not assetto-infra)
    """
    if not cfg_path:
        return ""

    normalized = cfg_path.replace("\\", "/")
    match = _SERVER_NUM_PATTERN.search(normalized)
    if match:
        return match.group(1).lower()

    path = Path(cfg_path)
    if path.name != "server_cfg.ini":
        return ""

    parent = path.parent
    if parent.name == "cfg":
        return parent.parent.name.lower()
    return parent.name.lower()


def cfg_path_priority(cfg_path: str) -> int:
    """Higher priority wins when multiple ini files share the same listen port."""
    normalized = cfg_path.replace("\\", "/")
    if _SERVER_NUM_PATTERN.search(normalized) and "/cfg/" in normalized:
        return 100
    if normalized.endswith("/cfg/server_cfg.ini"):
        return 50
    if normalized.endswith("/server_cfg.ini"):
        return 10
    return 0


def is_legacy_root_server_cfg(cfg_path: str, base_path: str) -> bool:
    """True for ``{SERVERS_PATH}/server_cfg.ini`` (legacy duplicate risk)."""
    if os.getenv("SKIP_LEGACY_SERVER_CFG", "true").strip().lower() not in (
        "1",
        "true",
        "yes",
        "on",
    ):
        return False
    try:
        legacy = os.path.normpath(os.path.join(base_path, "server_cfg.ini"))
        return os.path.normpath(cfg_path) == legacy
    except Exception:
        return False
