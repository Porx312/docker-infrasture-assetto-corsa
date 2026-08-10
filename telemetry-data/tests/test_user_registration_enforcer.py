import time
from unittest.mock import MagicMock, patch

from core import settings
from core.server_registry import register_server, reset_registry_for_tests
from core.session_manager import DriverInfo, ServerState
from core.user_registration_enforcer import (
    _handle_not_registered_message,
    is_steam_id_not_registered,
    kick_unregistered_driver,
    kick_steam_id_everywhere_unregistered,
    schedule_deferred_registration_kick,
    user_not_registered_redis_key,
)
from core.user_status_cache import reset_user_status_cache_for_tests


def setup_function():
    reset_registry_for_tests()
    reset_user_status_cache_for_tests()


def test_user_not_registered_redis_key():
    assert user_not_registered_redis_key("76561199000000001") == (
        "ac:user:not_registered:76561199000000001"
    )


@patch("core.user_registration_enforcer.settings.USER_REGISTRATION_REQUIRED", True)
@patch("core.user_registration_enforcer.settings.REDIS_HOST", "127.0.0.1")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=False)
@patch("core.redis_client.get_redis_client")
def test_is_steam_id_not_registered_reads_primary_key(
    mock_get_client,
    _mock_banned,
):
    redis = MagicMock()
    redis.get.side_effect = lambda key: (
        "1" if key == user_not_registered_redis_key("steam-a") else None
    )
    mock_get_client.return_value = redis

    assert is_steam_id_not_registered("steam-a") is True
    assert is_steam_id_not_registered("unknown_abc") is False


@patch("core.user_registration_enforcer.settings.USER_REGISTRATION_REQUIRED", True)
@patch("core.user_registration_enforcer.settings.REDIS_HOST", "127.0.0.1")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=True)
@patch("core.redis_client.get_redis_client")
def test_is_steam_id_not_registered_skips_when_banned(
    mock_get_client,
    _mock_banned,
):
    redis = MagicMock()
    redis.get.return_value = "1"
    mock_get_client.return_value = redis

    assert is_steam_id_not_registered("steam-a") is False


@patch("core.user_registration_enforcer.execute_warn_then_kick", return_value=True)
def test_kick_unregistered_driver_sends_chat_then_kick(mock_execute):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    server.sock = MagicMock()
    server.last_server_addr = ("127.0.0.1", 8081)
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    server.last_known_by_car_id = {3: {"guid": driver.guid}}

    kick_unregistered_driver(server, driver, "user_not_found")

    mock_execute.assert_called_once()
    assert mock_execute.call_args.args[2] == driver.guid


@patch("core.user_registration_enforcer.kick_unregistered_driver")
@patch("core.user_registration_enforcer.is_steam_id_not_registered")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=False)
@patch("core.user_registration_enforcer.time.sleep", return_value=None)
@patch("core.user_registration_enforcer.settings.USER_BAN_DEFER_ATTEMPTS", 2)
@patch("core.user_registration_enforcer.settings.USER_BAN_DEFER_POLL_MS", 1)
def test_schedule_deferred_registration_kick_skips_when_cleared(
    _sleep,
    _mock_banned,
    mock_is_not_registered,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    mock_is_not_registered.return_value = False

    schedule_deferred_registration_kick(server, driver)
    time.sleep(0.05)

    mock_kick.assert_not_called()


@patch("core.user_registration_enforcer.kick_unregistered_driver")
@patch("core.user_registration_enforcer.is_steam_id_not_registered")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=False)
@patch("core.user_registration_enforcer.time.sleep", return_value=None)
@patch("core.user_registration_enforcer.settings.USER_BAN_DEFER_ATTEMPTS", 2)
@patch("core.user_registration_enforcer.settings.USER_BAN_DEFER_POLL_MS", 1)
def test_schedule_deferred_registration_kick_kicks_when_still_not_registered(
    _sleep,
    _mock_banned,
    mock_is_not_registered,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    mock_is_not_registered.return_value = True

    schedule_deferred_registration_kick(server, driver)
    time.sleep(0.05)

    mock_kick.assert_called_once()


@patch("core.user_registration_enforcer.kick_unregistered_driver")
@patch("core.user_registration_enforcer.is_steam_id_not_registered")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=True)
@patch("core.user_registration_enforcer.time.sleep", return_value=None)
@patch("core.user_registration_enforcer.settings.USER_BAN_DEFER_ATTEMPTS", 2)
@patch("core.user_registration_enforcer.settings.USER_BAN_DEFER_POLL_MS", 1)
def test_schedule_deferred_registration_kick_skips_when_banned(
    _sleep,
    _mock_banned,
    mock_is_not_registered,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    mock_is_not_registered.return_value = True

    schedule_deferred_registration_kick(server, driver)
    time.sleep(0.05)

    mock_kick.assert_not_called()


@patch("core.user_registration_enforcer.kick_unregistered_driver")
def test_kick_steam_id_everywhere_unregistered_on_all_servers(mock_kick):
    reset_registry_for_tests()
    server_a = ServerState(12001, 8081, "track", "layout", "A")
    server_b = ServerState(12011, 8082, "track", "layout", "B")
    driver_a = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver_a.car_id = 1
    server_a.guid_to_driver[driver_a.guid] = driver_a
    driver_b = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver_b.car_id = 2
    server_b.guid_to_driver[driver_b.guid] = driver_b
    register_server(server_a)
    register_server(server_b)

    with patch("core.user_registration_enforcer.settings.USER_REGISTRATION_REQUIRED", True):
        with patch("core.user_registration_enforcer.is_steam_id_banned", return_value=False):
            kicked = kick_steam_id_everywhere_unregistered("76561199000000001")

    assert kicked == 2
    assert mock_kick.call_count == 2
    for call in mock_kick.call_args_list:
        assert call.kwargs.get("wait_client_loaded") is False


@patch("core.user_registration_enforcer.kick_unregistered_driver")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=False)
@patch("core.user_registration_enforcer.is_steam_id_not_registered", return_value=True)
def test_maybe_kick_unregistered_driver_on_car_update_skips_wait_client_loaded(
    _mock_not_reg,
    _mock_banned,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver

    from core.user_registration_enforcer import maybe_kick_unregistered_driver_on_car_update

    with patch("core.user_registration_enforcer.settings.USER_REGISTRATION_REQUIRED", True):
        maybe_kick_unregistered_driver_on_car_update(server, driver)

    mock_kick.assert_called_once()
    assert mock_kick.call_args.kwargs.get("wait_client_loaded") is False


@patch("core.user_registration_enforcer.settings.USER_REGISTRATION_REQUIRED", True)
@patch("core.user_registration_enforcer.settings.REDIS_HOST", "127.0.0.1")
@patch("core.user_registration_enforcer.is_steam_id_banned", return_value=False)
@patch("core.redis_client.get_redis_client")
def test_is_steam_id_not_registered_uses_ttl_cache(mock_get_client, _mock_banned):
    redis = MagicMock()
    redis.get.return_value = "1"
    mock_get_client.return_value = redis

    assert is_steam_id_not_registered("steam-cache") is True
    assert is_steam_id_not_registered("steam-cache", quiet=True) is True
    assert redis.get.call_count == 1


@patch("core.user_registration_enforcer.settings.USER_REGISTRATION_REQUIRED", False)
def test_is_steam_id_not_registered_disabled_flag():
    assert is_steam_id_not_registered("76561199000000001") is False


@patch("core.user_registration_enforcer.kick_steam_id_everywhere_unregistered")
def test_handle_not_registered_message_parses_json(mock_kick):
    _handle_not_registered_message('{"steamId":"76561199000000001","ts":1}')
    mock_kick.assert_called_once_with("76561199000000001")
