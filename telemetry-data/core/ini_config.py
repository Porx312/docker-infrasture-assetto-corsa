"""Shared server_cfg.ini decode and field extraction."""

from __future__ import annotations

import re
from typing import Optional

from core.cm_name import strip_cm_name_suffix


def decode_ini_bytes(raw: bytes) -> str:
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16", errors="ignore")
    if b"\x00" in raw[:256]:
        return raw.decode("utf-16le", errors="ignore")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-16le", errors="ignore")


def read_ini_file(cfg_path: str) -> Optional[str]:
    try:
        with open(cfg_path, "rb") as f:
            return decode_ini_bytes(f.read())
    except OSError:
        return None


def extract_server_name(content: str) -> str:
    server_name_m = re.search(r"^SERVER_NAME=(.+)", content, re.MULTILINE)
    if not server_name_m:
        server_name_m = re.search(r"^NAME=(.+)", content, re.MULTILINE)
    if server_name_m:
        return strip_cm_name_suffix(server_name_m.group(1).strip())
    return ""


def extract_track(content: str) -> Optional[str]:
    track_m = re.search(r"^TRACK=(.+)", content, re.MULTILINE)
    return track_m.group(1).strip() if track_m else None


def extract_config_track(content: str) -> Optional[str]:
    config_m = re.search(r"^CONFIG_TRACK=(.*)", content, re.MULTILINE)
    return config_m.group(1).strip() if config_m else None


def extract_udp_ports(content: str) -> tuple[Optional[int], Optional[int]]:
    plugin_port_m = re.search(r"^UDP_PLUGIN_LOCAL_PORT=(\d+)", content, re.MULTILINE)
    udp_addr_m = re.search(r"^UDP_PLUGIN_ADDRESS=(?:[^:]+:)?(\d+)", content, re.MULTILINE)
    cmd_port = int(plugin_port_m.group(1).strip()) if plugin_port_m else None
    listen_port = int(udp_addr_m.group(1).strip()) if udp_addr_m else None
    return listen_port, cmd_port


def apply_ini_to_server_state(server_state, cfg_path: str) -> bool:
    content = read_ini_file(cfg_path)
    if content is None:
        return False

    name = extract_server_name(content)
    if name:
        server_state.config_server_name = name

    track = extract_track(content)
    if track:
        server_state.track = track

    config_track = extract_config_track(content)
    if config_track is not None:
        server_state.config = config_track

    return True
