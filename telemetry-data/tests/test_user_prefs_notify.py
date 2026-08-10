"""Private chat when acceptBattle pref changes."""

from unittest.mock import MagicMock, patch

from core.session_manager import DriverInfo, ServerState
from core.server_registry import register_server, reset_registry_for_tests
from core.user_prefs_notify import (
    _parse_accept_battle_message,
    notify_accept_battle_change,
    reset_user_prefs_notify_subscriber_for_tests,
)


def setup_function():
    reset_registry_for_tests()
    reset_user_prefs_notify_subscriber_for_tests()


def test_parse_accept_battle_message():
    assert _parse_accept_battle_message('{"steamId":"76561199000000001","acceptBattle":false}') == (
        "76561199000000001",
        False,
    )
    assert _parse_accept_battle_message('{"steam_id":"76561199000000001","accept_battle":true}') == (
        "76561199000000001",
        True,
    )
    assert _parse_accept_battle_message("not-json") is None


@patch("core.user_prefs_notify.settings")
@patch("core.user_prefs_notify.send_chat")
def test_notify_accept_battle_change_sends_private_chat(mock_send_chat, mock_settings):
    mock_settings.USER_PREFS_NOTIFY_ENABLED = True
    mock_settings.USER_PREFS_ACCEPT_BATTLE_DISABLED_MESSAGE = "Battles disabled."

    server = ServerState(9600, 9600, "track", "layout", "test")
    server.last_server_addr = ("127.0.0.1", 9600)
    driver = DriverInfo("Pilot", "76561199000000001", "ae86")
    driver.car_id = 3
    server.guid_to_driver[driver.guid] = driver
    server.active_drivers[3] = driver
    register_server(server)

    sent = notify_accept_battle_change("76561199000000001", False)

    assert sent == 1
    mock_send_chat.assert_called_once_with(server, 3, "Battles disabled.")
