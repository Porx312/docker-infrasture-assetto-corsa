import json
from unittest.mock import MagicMock

import pytest

from core import runtime_config, settings
from core.driver_lifecycle import (
    is_driver_stale,
    purge_stale_drivers,
    remove_driver,
    try_purge_ghost_car_info_slot,
)
from core.redis_config_sync import apply_snapshot
from core.session_manager import DriverInfo, ServerState


@pytest.fixture
def server_state():
    state = ServerState(
        port=12000,
        server_cmd_port=12001,
        track="pk_akina",
        config="downhill",
        server_name="test",
        cfg_path="/tmp/server_cfg.ini",
    )
    state.battle_manager.remove_car = MagicMock()
    state.ghost_suspects = {}
    return state


def test_is_driver_stale_respects_timeout(monkeypatch, server_state):
    monkeypatch.setattr(settings, "GHOST_DRIVER_TIMEOUT_MS", 1000)
    driver = DriverInfo("Pilot", "76561199230780195", "car")
    driver.last_seen_ms = 5000
    assert is_driver_stale(driver, at_ms=7000) is True
    assert is_driver_stale(driver, at_ms=5500) is False


def test_purge_stale_drivers_emits_leave(monkeypatch, server_state):
    monkeypatch.setattr(settings, "GHOST_DRIVER_TIMEOUT_MS", 1000)
    driver = DriverInfo("Pilot", "76561199230780195", "car")
    driver.last_seen_ms = 1000
    server_state.active_drivers[0] = driver
    server_state.guid_to_driver[driver.guid] = driver

    sent = []

    def _capture(event, server, payload):
        sent.append((event, payload))

    monkeypatch.setattr("core.driver_lifecycle.send_server_event", _capture)

    removed = purge_stale_drivers(server_state, at_ms=3000)
    assert removed == 1
    assert 0 not in server_state.active_drivers
    assert sent[0][0] == "player_leave"
    server_state.battle_manager.remove_car.assert_called_once_with(driver.guid)


def test_try_purge_ghost_car_info_slot_debounce(monkeypatch, server_state):
    monkeypatch.setattr(settings, "GHOST_CARINFO_DEBOUNCE_MS", 5000)
    monkeypatch.setattr(settings, "GHOST_DRIVER_TIMEOUT_MS", 1000)
    driver = DriverInfo("Pilot", "76561199230780195", "car")
    driver.last_seen_ms = 1000
    server_state.active_drivers[2] = driver
    server_state.guid_to_driver[driver.guid] = driver

    assert try_purge_ghost_car_info_slot(server_state, 2, at_ms=2000) is False
    assert 2 in server_state.active_drivers

    monkeypatch.setattr("core.driver_lifecycle.send_server_event", MagicMock())
    assert try_purge_ghost_car_info_slot(server_state, 2, at_ms=8000) is True
    assert 2 not in server_state.active_drivers


def test_remove_driver_skips_unknown_guid(monkeypatch, server_state):
    monkeypatch.setattr("core.driver_lifecycle.send_server_event", MagicMock())
    driver = DriverInfo("Ghost", "unknown_0", "car")
    server_state.active_drivers[0] = driver
    remove_driver(server_state, 0, driver)
    server_state.battle_manager.remove_car.assert_called_once_with("unknown_0")


def test_apply_snapshot_persists_version_under_state_dir(monkeypatch, tmp_path):
    versions_file = str(tmp_path / "redis_applied_config_versions.json")
    monkeypatch.setattr(settings, "AC_INSTANCE_ID", "test-instance")
    monkeypatch.setattr(settings, "REDIS_APPLIED_CONFIG_VERSIONS_FILE", versions_file)

    runtime_config.set_server_modes([])
    payload = {
        "instanceId": "test-instance",
        "data": {
            "instanceId": "test-instance",
            "version": "v2",
            "servers": [{"serverName": "server-1", "displayName": "BattleOne", "type": "battle"}],
        },
    }
    applied, errors = apply_snapshot({}, payload)
    assert applied == 1
    assert errors == 0

    with open(versions_file, encoding="utf-8") as f:
        saved = json.load(f)
    assert saved["test-instance"] == "v2"

    applied_again, _ = apply_snapshot({}, payload)
    assert applied_again == 0
