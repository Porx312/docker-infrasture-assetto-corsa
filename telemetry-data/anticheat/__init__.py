"""ACSP telemetry anticheat (observe-only by default).

Does not kick/ban. Does not claim client/memory/physics cheat detection beyond
inconsistencies visible in parsed ACSP fields (CAR_UPDATE, LAP_COMPLETED).
"""

from __future__ import annotations

from anticheat.config import AnticheatConfig, load_config
from anticheat.engine import AnticheatEngine, create_engine, get_engine, reset_engine_for_tests
from anticheat.types import EvidenceEvent, SampleDisposition, TickResult

__all__ = [
    "AnticheatConfig",
    "AnticheatEngine",
    "EvidenceEvent",
    "SampleDisposition",
    "TickResult",
    "create_engine",
    "get_engine",
    "load_config",
    "reset_engine_for_tests",
    "server_key_from_state",
]


def server_key_from_state(server_state) -> str:
    """Stable key for per-server state isolation (folder id preferred)."""
    folder = (getattr(server_state, "server_folder_id", None) or "").strip()
    if folder:
        return folder
    name = (getattr(server_state, "config_server_name", None) or "").strip()
    if name:
        return name
    name = (getattr(server_state, "server_name", None) or "").strip()
    if name:
        return name
    port = getattr(server_state, "port", None)
    if port is not None:
        return f"port:{port}"
    return "unknown"
