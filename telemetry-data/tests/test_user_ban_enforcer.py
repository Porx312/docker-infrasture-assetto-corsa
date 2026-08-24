import time
from unittest.mock import MagicMock, patch

from core.server_registry import register_server, reset_registry_for_tests
from core.session_manager import DriverInfo, ServerState
from core.user_ban_enforcer import (
    _handle_invalidation_message,
    is_steam_id_banned,
    kick_driver,
    kick_steam_id_everywhere,
    reset_defer_ban_kick_scheduled_for_tests,
    user_invalidated_redis_key,
)
from core.user_status_cache import (
    invalidate_banned_cache,
    reset_user_status_cache_for_tests,
    seed_banned_cache,
    write_banned_cached,
)


def setup_function():
    reset_registry_for_tests()
    reset_user_status_cache_for_tests()
    reset_defer_ban_kick_scheduled_for_tests()


def test_user_invalidated_redis_key():
    assert user_invalidated_redis_key("76561199000000001") == "ac:user:invalidated:76561199000000001"


@patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True)
@patch("core.user_ban_enforcer.settings.REDIS_HOST", "127.0.0.1")
@patch("core.redis_client.get_redis_client")
def test_is_steam_id_banned_reads_primary_key(mock_get_client):
    redis = MagicMock()
    redis.get.side_effect = lambda key: "1" if key == user_invalidated_redis_key("steam-a") else None
    mock_get_client.return_value = redis

    assert is_steam_id_banned("steam-a") is True
    assert is_steam_id_banned("unknown_abc") is False


@patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True)
@patch("core.user_ban_enforcer.settings.REDIS_HOST", "127.0.0.1")
@patch("core.redis_client.get_redis_client")
def test_is_steam_id_banned_uses_ttl_cache(mock_get_client):
    redis = MagicMock()
    redis.get.return_value = "1"
    mock_get_client.return_value = redis

    assert is_steam_id_banned("steam-cache") is True
    assert is_steam_id_banned("steam-cache", quiet=True) is True
    assert redis.get.call_count == 1


@patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True)
@patch("core.user_ban_enforcer.settings.REDIS_HOST", "127.0.0.1")
@patch("core.redis_client.get_redis_client")
def test_is_steam_id_banned_force_refresh_bypasses_stale_cache(mock_get_client):
    redis = MagicMock()
    redis.get.return_value = "1"
    mock_get_client.return_value = redis
    write_banned_cached("steam-stale", False)

    assert is_steam_id_banned("steam-stale") is False
    assert is_steam_id_banned("steam-stale", force_refresh=True) is True
    assert redis.get.call_count == 1


@patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True)
@patch("core.user_ban_enforcer.kick_steam_id_everywhere")
def test_handle_invalidation_message_seeds_cache_before_kick(mock_kick):
    steam_id = "76561199000000001"
    write_banned_cached(steam_id, False)

    _handle_invalidation_message(f'{{"steamId":"{steam_id}","ts":1}}')

    mock_kick.assert_called_once_with(steam_id)
    assert is_steam_id_banned(steam_id) is True


@patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", False)
def test_is_steam_id_banned_disabled_flag():
    assert is_steam_id_banned("76561199000000001") is False


@patch("core.user_ban_enforcer.kick_steam_id_everywhere")
def test_handle_invalidation_message_parses_json(mock_kick):
    _handle_invalidation_message('{"steamId":"76561199000000001","ts":1}')
    mock_kick.assert_called_once_with("76561199000000001")


@patch("core.user_ban_enforcer.execute_warn_then_kick", return_value=True)
def test_kick_driver_sends_warn_then_single_kick(mock_execute):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    server.sock = MagicMock()
    server.last_server_addr = ("127.0.0.1", 8081)
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    server.last_known_by_car_id = {3: {"guid": driver.guid}}

    kick_driver(server, driver, "user_invalidated")

    mock_execute.assert_called_once()
    assert mock_execute.call_args.args[2] == driver.guid
    assert 3 in server.active_drivers


@patch("core.user_ban_enforcer.kick_driver")
@patch("core.user_ban_enforcer.is_steam_id_banned")
@patch("core.user_ban_enforcer.time.sleep", return_value=None)
@patch("core.user_ban_enforcer.settings.USER_BAN_DEFER_ATTEMPTS", 2)
@patch("core.user_ban_enforcer.settings.USER_BAN_DEFER_POLL_MS", 1)
def test_schedule_deferred_ban_kick_skips_when_ban_cleared(
    _sleep,
    mock_is_banned,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    mock_is_banned.return_value = False

    from core.user_ban_enforcer import schedule_deferred_ban_kick

    schedule_deferred_ban_kick(server, driver)
    time.sleep(0.05)

    mock_kick.assert_not_called()


@patch("core.user_ban_enforcer.kick_driver")
@patch("core.user_ban_enforcer.is_steam_id_banned")
@patch("core.user_ban_enforcer.time.sleep", return_value=None)
@patch("core.user_ban_enforcer.settings.USER_BAN_DEFER_ATTEMPTS", 2)
@patch("core.user_ban_enforcer.settings.USER_BAN_DEFER_POLL_MS", 1)
def test_schedule_deferred_ban_kick_kicks_when_still_banned(
    _sleep,
    mock_is_banned,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    mock_is_banned.return_value = True

    from core.user_ban_enforcer import schedule_deferred_ban_kick

    schedule_deferred_ban_kick(server, driver)
    time.sleep(0.05)

    mock_kick.assert_called_once()


@patch("core.user_ban_enforcer.kick_driver")
@patch("core.user_ban_enforcer.is_steam_id_banned")
@patch("core.user_ban_enforcer.time.sleep", return_value=None)
@patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True)
@patch("core.user_ban_enforcer.settings.USER_BAN_DEFER_ATTEMPTS", 3)
@patch("core.user_ban_enforcer.settings.USER_BAN_DEFER_POLL_MS", 1)
def test_schedule_deferred_ban_kick_sticky_after_transient_clear(
    _sleep,
    mock_is_banned,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver
    mock_is_banned.side_effect = [True, False, False]

    from core.user_ban_enforcer import schedule_deferred_ban_kick

    schedule_deferred_ban_kick(server, driver)
    time.sleep(0.05)

    mock_kick.assert_called_once()


@patch("core.user_ban_enforcer.kick_driver")
def test_kick_steam_id_everywhere_on_all_servers(mock_kick):
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

    with patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True):
        kicked = kick_steam_id_everywhere("76561199000000001")

    assert kicked == 2
    assert mock_kick.call_count == 2
    for call in mock_kick.call_args_list:
        assert call.kwargs.get("wait_client_loaded") is False


@patch("core.user_ban_enforcer.kick_driver")
@patch("core.user_ban_enforcer.is_steam_id_banned", return_value=True)
def test_maybe_kick_banned_driver_on_car_update_skips_wait_client_loaded(
    _mock_banned,
    mock_kick,
):
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 3
    server.active_drivers[3] = driver
    server.guid_to_driver[driver.guid] = driver

    from core.user_ban_enforcer import maybe_kick_banned_driver_on_car_update

    with patch("core.user_ban_enforcer.settings.USER_BAN_ENABLED", True):
        maybe_kick_banned_driver_on_car_update(server, driver)

    mock_kick.assert_called_once()
    assert mock_kick.call_args.kwargs.get("wait_client_loaded") is False


def test_find_driver_by_steam_id_uses_last_known_cache():
    reset_registry_for_tests()
    server = ServerState(12001, 8081, "track", "layout", "Test Server")
    server.last_known_by_car_id = {
        5: {
            "guid": "76561199000000099",
            "name": "Pilot",
            "model": "ks_toyota_gt86",
        }
    }
    register_server(server)

    from core.server_registry import find_driver_by_steam_id

    matches = find_driver_by_steam_id("76561199000000099")
    assert len(matches) == 1
    assert matches[0][1].car_id == 5
