import struct
from unittest.mock import MagicMock, patch

import pytest

from core.packet_processor import process_packet
from core.session_manager import ServerState
from network.ac_packet import ACSP


def _encode_wstring(text: str) -> bytes:
    out = struct.pack("<B", len(text))
    for char in text:
        out += char.encode("utf-32-le")
    return out


def _encode_string(text: str) -> bytes:
    raw = text.encode("utf-8")
    return struct.pack("<B", len(raw)) + raw


def _new_connection_packet(
    name: str = "Pilot",
    guid: str = "76561199230780195",
    car_id: int = 0,
    model: str = "ks_mazda_rx7_spirit_r",
) -> bytes:
    payload = struct.pack("<B", ACSP.NEW_CONNECTION)
    payload += _encode_wstring(name)
    payload += _encode_wstring(guid)
    payload += struct.pack("<B", car_id)
    payload += _encode_string(model)
    payload += _encode_string("")
    return payload


def _connection_closed_packet(
    name: str = "Pilot",
    guid: str = "76561199230780195",
    car_id: int = 0,
) -> bytes:
    payload = struct.pack("<B", ACSP.CONNECTION_CLOSED)
    payload += _encode_wstring(name)
    payload += _encode_wstring(guid)
    payload += struct.pack("<B", car_id)
    return payload


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
    state.battle_manager.remove_car = MagicMock()
    state.last_server_addr = ("127.0.0.1", 12001)
    return state


@patch("core.packet_processor.schedule_deferred_ban_kick")
@patch("core.packet_processor.is_steam_id_banned", return_value=False)
@patch("core.handlers.new_connection.send_server_event")
def test_new_connection_publishes_player_join(
    mock_send,
    _mock_banned,
    _mock_defer,
    server_state,
):
    process_packet(_new_connection_packet(), server_state, ("127.0.0.1", 12001))

    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == "player_join"
    assert mock_send.call_args.args[2]["steamId"] == "76561199230780195"
    assert server_state.guid_to_driver["76561199230780195"].car_id == 0


@patch("core.driver_lifecycle.send_server_event")
def test_connection_closed_publishes_player_leave(mock_send, server_state):
    with patch("core.packet_processor.schedule_deferred_ban_kick"), patch(
        "core.packet_processor.is_steam_id_banned",
        return_value=False,
    ), patch("core.handlers.new_connection.send_server_event"):
        process_packet(_new_connection_packet(), server_state, ("127.0.0.1", 12001))
    mock_send.reset_mock()

    process_packet(_connection_closed_packet(), server_state, ("127.0.0.1", 12001))

    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == "player_leave"
    assert mock_send.call_args.args[2]["name"] == "Pilot"
    assert mock_send.call_args.args[2]["steamId"] == "76561199230780195"
    server_state.battle_manager.remove_car.assert_called_once_with("76561199230780195")
    assert 0 not in server_state.active_drivers
