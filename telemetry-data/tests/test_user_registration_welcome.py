"""Private chat when Steam registration clears mid-session."""

from unittest.mock import patch

from core.session_manager import DriverInfo, ServerState
from core.server_registry import register_server, reset_registry_for_tests
from core.user_registration_welcome import (
    _parse_registered_message,
    notify_registered_welcome,
    reset_user_registered_welcome_subscriber_for_tests,
)


def setup_function():
    reset_registry_for_tests()
    reset_user_registered_welcome_subscriber_for_tests()


def test_parse_registered_message():
    assert _parse_registered_message('{"steamId":"76561199000000001","ts":1}') == "76561199000000001"
    assert _parse_registered_message('{"steam_id":"76561199000000001"}') == "76561199000000001"
    assert _parse_registered_message("") is None


@patch("core.user_registration_welcome.settings")
@patch("core.steam_id_chat_notify.send_chat")
def test_notify_registered_welcome_sends_private_chat(mock_send_chat, mock_settings):
    mock_settings.USER_REGISTERED_WELCOME_ENABLED = True
    mock_settings.USER_REGISTERED_WELCOME_MESSAGE = "Steam linked — welcome."

    server = ServerState(9600, 9600, "track", "layout", "test")
    server.last_server_addr = ("127.0.0.1", 9600)
    driver = DriverInfo("Pilot", "76561199000000001", "ae86")
    driver.car_id = 4
    server.guid_to_driver[driver.guid] = driver
    server.active_drivers[4] = driver
    register_server(server)

    sent = notify_registered_welcome("76561199000000001")

    assert sent == 1
    mock_send_chat.assert_called_once_with(server, 4, "Steam linked — welcome.")
