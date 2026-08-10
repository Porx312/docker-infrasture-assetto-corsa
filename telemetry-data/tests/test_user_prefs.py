"""User profile prefs (saveTime / acceptBattle) from Redis."""

from unittest.mock import MagicMock, patch

from core.user_prefs import (
    accept_battle_redis_key,
    filter_battle_accept_eligible,
    is_steam_id_battle_eligible,
    reset_user_prefs_cache_for_tests,
    save_time_redis_key,
)


def setup_function():
    reset_user_prefs_cache_for_tests()


@patch("core.user_prefs.settings")
def test_is_steam_id_battle_eligible_defaults_true(mock_settings):
    mock_settings.REDIS_HOST = "localhost"
    mock_redis = MagicMock()
    mock_redis.get.return_value = None
    with patch("core.redis_client.get_redis_client", return_value=mock_redis):
        assert is_steam_id_battle_eligible("76561199000000001") is True


@patch("core.user_prefs.settings")
def test_is_steam_id_battle_eligible_false_when_key_is_zero(mock_settings):
    mock_settings.REDIS_HOST = "localhost"
    mock_redis = MagicMock()
    mock_redis.get.return_value = b"0"
    with patch("core.redis_client.get_redis_client", return_value=mock_redis):
        assert is_steam_id_battle_eligible("76561199000000001") is False


@patch("core.user_prefs.settings")
def test_filter_battle_accept_eligible_batch(mock_settings):
    mock_settings.REDIS_HOST = "localhost"
    mock_redis = MagicMock()
    mock_redis.mget.return_value = [None, b"0"]
    with patch("core.redis_client.get_redis_client", return_value=mock_redis):
        eligible = filter_battle_accept_eligible(["steam-a", "steam-b"])
    assert eligible == {"steam-a"}
    mock_redis.mget.assert_called_once_with(
        [accept_battle_redis_key("steam-a"), accept_battle_redis_key("steam-b")]
    )


def test_redis_key_helpers():
    assert save_time_redis_key("76561199000000001") == "ac:user:prefs:save_time:76561199000000001"
    assert (
        accept_battle_redis_key("76561199000000001")
        == "ac:user:prefs:accept_battle:76561199000000001"
    )
