import struct
from unittest.mock import MagicMock

from core.session_manager import ServerState, send_admin_command, send_kick_user


def test_send_kick_user_uses_acsp_packet_206():
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    sock = MagicMock()
    server.sock = sock
    server.last_server_addr = ("127.0.0.1", 8081)

    send_kick_user(server, 7)

    sock.sendto.assert_called_once()
    packet, target = sock.sendto.call_args[0]
    assert target == ("127.0.0.1", 8081)
    assert packet == struct.pack("<BB", 206, 7)


def test_send_admin_command_uses_acsp_packet_209():
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    sock = MagicMock()
    server.sock = sock
    server.last_server_addr = ("127.0.0.1", 8081)

    send_admin_command(server, "/pit 2")

    sock.sendto.assert_called_once()
    packet, _target = sock.sendto.call_args[0]
    cmd_bytes = "/pit 2".encode("utf-32le")
    expected = struct.pack(f"<BB{len(cmd_bytes)}s", 209, len("/pit 2"), cmd_bytes)
    assert packet == expected
