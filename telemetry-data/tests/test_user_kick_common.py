from unittest.mock import MagicMock, patch

from core.session_manager import DriverInfo, ServerState
from core.user_kick_common import (
    clear_kick_state,
    execute_warn_then_kick,
    reset_kick_state_for_tests,
)


@patch("core.user_kick_common.send_admin_command")
@patch("core.user_kick_common.send_kick_user")
@patch("core.user_kick_common.send_chat")
@patch("core.user_kick_common.time.sleep", return_value=None)
def test_execute_warn_then_kick_chat_wait_kick_once(_sleep, mock_chat, mock_kick, mock_admin):
    reset_kick_state_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test")
    server.sock = MagicMock()
    server.last_server_addr = ("127.0.0.1", 8081)
    guid = "76561199000000001"
    driver = DriverInfo("Pilot", guid, "ks_toyota_gt86")
    driver.car_id = 3
    driver.client_loaded = True
    server.active_drivers[3] = driver
    server.guid_to_driver[guid] = driver

    assert execute_warn_then_kick(
        server,
        3,
        guid,
        "Hello",
        3.0,
        log_label="test",
        wait_client_loaded=False,
    ) is True
    mock_chat.assert_called_once_with(server, 3, "Hello")
    _sleep.assert_called_once_with(3.0)
    mock_kick.assert_called_once_with(server, 3)
    mock_admin.assert_called_once_with(server, "/kick_id 3")

    mock_chat.reset_mock()
    mock_kick.reset_mock()
    assert execute_warn_then_kick(
        server,
        3,
        guid,
        "Hello",
        3.0,
        log_label="test",
        wait_client_loaded=False,
    ) is False
    mock_chat.assert_not_called()
    mock_kick.assert_not_called()

    clear_kick_state(server.port, guid)
    assert execute_warn_then_kick(
        server,
        3,
        guid,
        "Again",
        1.0,
        log_label="test",
        wait_client_loaded=False,
    ) is True
