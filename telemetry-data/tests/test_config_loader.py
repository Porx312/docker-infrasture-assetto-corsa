import os
from pathlib import Path

import pytest

from core.config_loader import load_server_configs
from core import runtime_config


class _MinimalState:
    def __init__(self, port, server_cmd_port, track, config, server_name, cfg_path=None):
        self.port = port
        self.server_cmd_port = server_cmd_port
        self.track = track
        self.config = config
        self.config_server_name = server_name
        self.server_name = server_name
        self.cfg_path = cfg_path
        self.server_folder_id = ""


def _write_ini(path: Path, name: str, listen_port: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                f"NAME={name}",
                "TRACK=akina",
                "CONFIG_TRACK=uphill",
                "UDP_PLUGIN_LOCAL_PORT=12001",
                f"UDP_PLUGIN_ADDRESS=127.0.0.1:{listen_port}",
            ]
        ),
        encoding="utf-8",
    )


def test_config_loader_prefers_server_n_on_port_conflict(monkeypatch, tmp_path):
    base = tmp_path / "server"
    _write_ini(base / "server_cfg.ini", "akina", 12000)
    _write_ini(base / "server-2" / "cfg" / "server_cfg.ini", "battle test", 12000)

    monkeypatch.setenv("SERVERS_PATH", str(base))
    monkeypatch.setenv("TIME_ATTACK_SERVERS_PATH", "")
    monkeypatch.setenv("EVENTS_SERVERS_PATH", "")
    monkeypatch.setenv("SKIP_LEGACY_SERVER_CFG", "false")

    servers = load_server_configs(_MinimalState)
    assert 12000 in servers
    state = servers[12000]
    assert state.server_folder_id == "server-2"
    assert state.config_server_name == "battle test"


def test_get_mode_by_folder_server_2():
    runtime_config.set_server_modes(
        [{"serverName": "server-2", "displayName": "battle test", "type": "battle"}]
    )

    class _State:
        server_folder_id = "server-2"
        config_server_name = "battle test"
        server_name = "akina"

    assert runtime_config.get_mode_for_state(_State()) == "battle"
