import os
import tempfile

from core import runtime_config, settings
from core.redis_config_sync import _write_server_cfg, apply_snapshot


class _FakeState:
    def __init__(self, cfg_path, folder_id, config_name):
        self.cfg_path = cfg_path
        self.server_folder_id = folder_id
        self.config_server_name = config_name
        self.server_name = config_name


def test_apply_snapshot_runtime_only(monkeypatch, tmp_path):
    versions_file = str(tmp_path / "versions.json")
    monkeypatch.setattr(settings, "AC_INSTANCE_ID", "test-instance")
    monkeypatch.setattr(settings, "REDIS_CONFIG_INI_WRITE_ENABLED", False)
    monkeypatch.setattr("core.redis_config_sync._VERSIONS_FILE", versions_file)

    runtime_config.set_server_modes([])
    payload = {
        "instanceId": "test-instance",
        "data": {
            "instanceId": "test-instance",
            "version": "v1",
            "servers": [
                {
                    "serverName": "server-1",
                    "displayName": "BattleOne",
                    "type": "battle",
                }
            ],
        },
    }
    applied, errors = apply_snapshot({}, payload)
    assert applied == 1
    assert errors == 0
    assert runtime_config.get_mode_for_state(
        _FakeState("", "server-1", "BattleOne")
    ) == "battle"


def test_write_server_cfg_updates_track():
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = os.path.join(tmp, "server_cfg.ini")
        with open(cfg_path, "w", encoding="utf-8") as f:
            f.write("[SERVER]\nNAME=Old\nTRACK=old_track\n")
        changed = _write_server_cfg(
            cfg_path,
            {"displayName": "NewName", "track": "new_track", "trackConfig": "cfg"},
        )
        assert "TRACK" in changed
        content = open(cfg_path, encoding="utf-8").read()
        assert "TRACK=new_track" in content
        assert "NAME=NewName" in content


def test_write_server_cfg_config_track_default_becomes_empty():
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = os.path.join(tmp, "server_cfg.ini")
        with open(cfg_path, "w", encoding="utf-8") as f:
            f.write("[SERVER]\nCONFIG_TRACK=default\n")
        changed = _write_server_cfg(cfg_path, {"trackConfig": "default"})
        assert "CONFIG_TRACK" in changed
        content = open(cfg_path, encoding="utf-8").read()
        assert "CONFIG_TRACK=\n" in content or content.rstrip().endswith("CONFIG_TRACK=")
        assert "CONFIG_TRACK=default" not in content


def test_write_server_cfg_config_track_layout_preserved():
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = os.path.join(tmp, "server_cfg.ini")
        with open(cfg_path, "w", encoding="utf-8") as f:
            f.write("[SERVER]\nCONFIG_TRACK=\n")
        _write_server_cfg(cfg_path, {"trackConfig": "  akina_downhill  "})
        content = open(cfg_path, encoding="utf-8").read()
        assert "CONFIG_TRACK=akina_downhill" in content
