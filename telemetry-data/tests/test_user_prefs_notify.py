"""Private chat when acceptBattle or saveTime pref changes."""

from unittest.mock import MagicMock, patch

from core.session_manager import DriverInfo, ServerState
from core.server_registry import register_server, reset_registry_for_tests
from core.user_prefs_notify import (
    _parse_pref_notify_message,
    notify_pref_change,
    reset_user_prefs_notify_subscriber_for_tests,
)


def setup_function():
    reset_registry_for_tests()
    reset_user_prefs_notify_subscriber_for_tests()


def test_parse_pref_notify_message_new_format():
    assert _parse_pref_notify_message(
        '{"steamId":"76561199000000001","pref":"acceptBattle","enabled":false,"ts":1}'
    ) == ("76561199000000001", "acceptBattle", False)
    assert _parse_pref_notify_message(
        '{"steamId":"76561199000000001","pref":"saveTime","enabled":true,"ts":1}'
    ) == ("76561199000000001", "saveTime", True)


def test_parse_pref_notify_message_legacy_accept_battle():
    assert _parse_pref_notify_message('{"steamId":"76561199000000001","acceptBattle":false}') == (
        "76561199000000001",
        "acceptBattle",
        False,
    )
    assert _parse_pref_notify_message('{"steam_id":"76561199000000001","accept_battle":true}') == (
        "76561199000000001",
        "acceptBattle",
        True,
    )
    assert _parse_pref_notify_message("not-json") is None


@patch("core.user_prefs_notify.settings")
@patch("core.steam_id_chat_notify.send_chat")
def test_notify_pref_change_accept_battle(mock_send_chat, mock_settings):
    mock_settings.USER_PREFS_NOTIFY_ENABLED = True
    mock_settings.USER_PREFS_ACCEPT_BATTLE_DISABLED_MESSAGE = "Battles disabled."

    server = ServerState(9600, 9600, "track", "layout", "test")
    server.last_server_addr = ("127.0.0.1", 9600)
    driver = DriverInfo("Pilot", "76561199000000001", "ae86")
    driver.car_id = 3
    server.guid_to_driver[driver.guid] = driver
    server.active_drivers[3] = driver
    register_server(server)

    sent = notify_pref_change("76561199000000001", "acceptBattle", False)

    assert sent == 1
    mock_send_chat.assert_called_once_with(server, 3, "Battles disabled.")


@patch("core.user_prefs_notify.settings")
@patch("core.steam_id_chat_notify.send_chat")
def test_notify_pref_change_save_time(mock_send_chat, mock_settings):
    mock_settings.USER_PREFS_NOTIFY_ENABLED = True
    mock_settings.USER_PREFS_SAVE_TIME_ENABLED_MESSAGE = "Times saved."

    server = ServerState(9600, 9600, "track", "layout", "test")
    server.last_server_addr = ("127.0.0.1", 9600)
    driver = DriverInfo("Pilot", "76561199000000001", "ae86")
    driver.car_id = 2
    server.guid_to_driver[driver.guid] = driver
    server.active_drivers[2] = driver
    register_server(server)

    sent = notify_pref_change("76561199000000001", "saveTime", True)

    assert sent == 1
    mock_send_chat.assert_called_once_with(server, 2, "Times saved.")
