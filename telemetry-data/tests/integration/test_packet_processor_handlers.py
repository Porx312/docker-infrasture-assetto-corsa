import struct
from unittest.mock import MagicMock, patch

import pytest

from core import runtime_config, settings
from core.ini_config import decode_ini_bytes, extract_server_name, extract_track, extract_udp_ports
from core.packet_processor import process_packet
from core.session_manager import DriverInfo, ServerState
from network.ac_packet import ACSP


def test_decode_ini_bytes_utf16():
    raw = "TRACK=pk_akina\n".encode("utf-16le")
    content = decode_ini_bytes(raw)
    assert "pk_akina" in content


def test_extract_udp_ports_and_track():
    content = "UDP_PLUGIN_LOCAL_PORT=12001\nUDP_PLUGIN_ADDRESS=127.0.0.1:12000\nTRACK=pk_akina\nSERVER_NAME=Test"
    listen, cmd = extract_udp_ports(content)
    assert listen == 12000
    assert cmd == 12001
    assert extract_track(content) == "pk_akina"
    assert extract_server_name(content) == "Test"


def _encode_wstring(text: str) -> bytes:
    out = struct.pack("<B", len(text))
    for char in text:
        out += char.encode("utf-32-le")
    return out


def _car_info_packet(
    car_id: int = 0,
    is_connected: int = 1,
    name: str = "",
    guid: str = "",
) -> bytes:
    payload = struct.pack("<BB", ACSP.CAR_INFO, car_id)
    payload += struct.pack("<B", is_connected)
    payload += _encode_wstring("model")
    payload += _encode_wstring("skin")
    payload += _encode_wstring(name)
    payload += _encode_wstring("team")
    payload += _encode_wstring(guid)
    return payload


def _car_update_packet(car_id: int = 0, spline: float = 0.5) -> bytes:
    return struct.pack(
        "<B B f f f f f f B H f",
        getattr(ACSP, "CAR_UPDATE", 53),
        car_id,
        1.0,
        2.0,
        3.0,
        10.0,
        0.0,
        0.0,
        3,
        5000,
        spline,
    )


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
    state.battle_manager.set_server_mode = MagicMock()
    state.battle_manager.update = MagicMock()
    state.last_server_addr = ("127.0.0.1", 12001)
    state.ghost_suspects = {}
    return state


@pytest.fixture(autouse=True)
def _reset_runtime_modes():
    runtime_config.set_server_modes([])
    yield
    runtime_config.set_server_modes([])


@patch("core.driver_lifecycle.send_server_event")
def test_car_info_ghost_purge_after_debounce(mock_send, monkeypatch, server_state):
    monkeypatch.setattr(settings, "GHOST_CARINFO_DEBOUNCE_MS", 0)
    monkeypatch.setattr(settings, "GHOST_DRIVER_TIMEOUT_MS", 1000)

    driver = DriverInfo("Pilot", "76561199230780195", "car")
    driver.last_seen_ms = 1000
    server_state.active_drivers[0] = driver
    server_state.guid_to_driver[driver.guid] = driver

    process_packet(_car_info_packet(is_connected=0), server_state, ("127.0.0.1", 12001))
    assert 0 in server_state.active_drivers

    server_state.ghost_suspects[0] = 1000
    process_packet(_car_info_packet(is_connected=0), server_state, ("127.0.0.1", 12001))

    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == "player_leave"
    assert 0 not in server_state.active_drivers
    server_state.battle_manager.remove_car.assert_called_once_with(driver.guid)


@patch("core.handlers.car_update.maybe_kick_banned_driver_on_car_update")
def test_car_update_battle_path(_mock_kick, server_state):
    runtime_config.set_server_modes(
        [{"serverName": "server", "displayName": "test", "type": "battle"}]
    )
    driver = DriverInfo("Pilot", "76561199230780195", "car")
    driver.last_seen_ms = 0
    server_state.active_drivers[0] = driver
    server_state.guid_to_driver[driver.guid] = driver
    server_state.event_engine.check_idle = MagicMock()

    process_packet(_car_update_packet(spline=0.42), server_state, ("127.0.0.1", 12001))

    server_state.battle_manager.set_server_mode.assert_called_with(True)
    server_state.battle_manager.update.assert_called_once()
    args = server_state.battle_manager.update.call_args.args
    assert args[0] == driver.guid
    assert args[1] == pytest.approx(0.42)


@patch("core.handlers.new_session.send_registration")
def test_new_session_reloads_ini(mock_register, server_state, tmp_path):
    ini_path = tmp_path / "server_cfg.ini"
    ini_path.write_text("TRACK=ini_track\n", encoding="utf-8")
    server_state.cfg_path = str(ini_path)

    runtime_config.set_server_modes(
        [{"serverName": "server", "displayName": "test", "type": "battle"}]
    )
    payload = struct.pack("<BBBB", ACSP.NEW_SESSION, 1, 0, 0)
    payload += struct.pack("<B", 1)
    payload += _encode_wstring("Live Name")
    payload += b"\x06" + b"track1"
    payload += b"\x04" + b"cfg1"

    process_packet(payload, server_state, ("127.0.0.1", 12001))

    assert server_state.config_server_name == "" or server_state.track in ("track1", "ini_track")
    server_state.battle_manager.set_server_mode.assert_called_with(True)
    assert server_state.server_name == "Live Name"
    mock_register.assert_called_once()
