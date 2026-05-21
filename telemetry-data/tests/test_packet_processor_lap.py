import struct
from unittest.mock import MagicMock, patch

import pytest

from core import runtime_config
from core.packet_processor import process_packet
from core.session_manager import DriverInfo, ServerState
from network.ac_packet import ACSP


def _lap_completed_packet(car_id: int = 0, lap_time_ms: int = 120_000, cuts: int = 0) -> bytes:
    return struct.pack("<BBIB", ACSP.LAP_COMPLETED, car_id, lap_time_ms, cuts)


@pytest.fixture
def server_state():
    state = ServerState(
        port=12000,
        server_cmd_port=12001,
        track="pk_akina",
        config="akina_downhill",
        server_name="pord",
        cfg_path="/home/jose/assetto-infra/server/server/cfg/server_cfg.ini",
    )
    driver = DriverInfo("porx", "76561199230780195", "ks_mazda_rx7_spirit_r")
    driver.car_id = 0
    state.active_drivers[0] = driver
    state.guid_to_driver[driver.guid] = driver
    state.battle_manager.handle_lap_completed = MagicMock()
    state.last_server_addr = ("127.0.0.1", 12001)
    return state


@pytest.fixture(autouse=True)
def _reset_runtime_modes():
    runtime_config.set_server_modes([])
    yield
    runtime_config.set_server_modes([])


@patch("core.packet_processor.send_server_event")
def test_lap_completed_battle_does_not_publish(mock_send, server_state):
    runtime_config.set_server_modes(
        [{"serverName": "server", "displayName": "pord", "type": "battle"}]
    )
    process_packet(_lap_completed_packet(), server_state, ("127.0.0.1", 12001))
    mock_send.assert_not_called()
    server_state.battle_manager.handle_lap_completed.assert_called_once_with(
        "76561199230780195"
    )


@patch("core.packet_processor.send_server_event")
def test_lap_completed_unknown_mode_does_not_publish(mock_send, server_state):
    process_packet(_lap_completed_packet(), server_state, ("127.0.0.1", 12001))
    mock_send.assert_not_called()
    server_state.battle_manager.handle_lap_completed.assert_not_called()


@patch("core.packet_processor.send_server_event")
def test_lap_completed_time_attack_publishes(mock_send, server_state):
    runtime_config.set_server_modes(
        [{"serverName": "server", "displayName": "pord", "type": "time-attack"}]
    )
    process_packet(_lap_completed_packet(), server_state, ("127.0.0.1", 12001))
    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == "lap_completed"
    assert mock_send.call_args.args[2]["lapTime"] == 120_000
    server_state.battle_manager.handle_lap_completed.assert_not_called()
