"""Tests for HUD overlay presence gate (conn primary, sse fallback)."""

from unittest.mock import MagicMock, patch

import pytest

from core.hud_sse_presence import (
    filter_hud_eligible,
    has_hud_overlay_connected,
    hud_conn_redis_key,
    hud_sse_redis_key,
    is_hud_sse_active,
    reset_hud_sse_presence_cache_for_tests,
)


@pytest.fixture(autouse=True)
def _clear_cache():
    reset_hud_sse_presence_cache_for_tests()
    yield
    reset_hud_sse_presence_cache_for_tests()


def test_hud_conn_and_sse_redis_keys():
    assert hud_conn_redis_key("76561199000000001") == "ac:hud:conn:76561199000000001"
    assert hud_sse_redis_key("76561199000000001") == "ac:hud:sse:76561199000000001"


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", True)
@patch("core.redis_client.get_redis_client")
def test_is_hud_sse_active_reads_conn_key(mock_get_redis):
    redis = MagicMock()
    redis.exists.side_effect = lambda key: 1 if key.startswith("ac:hud:conn:") else 0
    mock_get_redis.return_value = redis

    assert is_hud_sse_active("76561199000000001") is True
    redis.exists.assert_called_once_with("ac:hud:conn:76561199000000001")


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", True)
@patch("core.redis_client.get_redis_client")
def test_is_hud_sse_active_falls_back_to_sse_key(mock_get_redis):
    redis = MagicMock()

    def exists(key: str) -> int:
        if key.startswith("ac:hud:conn:"):
            return 0
        if key.startswith("ac:hud:sse:"):
            return 1
        return 0

    redis.exists.side_effect = exists
    mock_get_redis.return_value = redis

    assert is_hud_sse_active("76561199000000001") is True
    assert redis.exists.call_count == 2


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", True)
@patch("core.redis_client.get_redis_client")
def test_is_hud_sse_active_false_when_missing(mock_get_redis):
    redis = MagicMock()
    redis.exists.return_value = 0
    mock_get_redis.return_value = redis

    assert is_hud_sse_active("76561199000000001") is False


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", False)
def test_is_hud_sse_active_skips_when_disabled():
    assert is_hud_sse_active("76561199000000001") is True


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", True)
@patch("core.redis_client.get_redis_client")
def test_filter_hud_eligible_batch(mock_get_redis):
    redis = MagicMock()
    redis.mget.side_effect = [
        ["1", None],  # conn keys
        [None],  # sse fallback for steam-b
    ]
    mock_get_redis.return_value = redis

    result = filter_hud_eligible(["steam-a", "steam-b"])
    assert result == {"steam-a"}


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", False)
def test_filter_hud_eligible_returns_all_when_disabled():
    guids = ["steam-a", "steam-b"]
    assert filter_hud_eligible(guids) == set(guids)


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", False)
@patch("core.redis_client.get_redis_client")
def test_has_hud_overlay_connected_reads_redis_even_when_matchmaking_disabled(
    mock_get_redis,
):
    redis = MagicMock()
    redis.exists.side_effect = lambda key: 1 if key.startswith("ac:hud:conn:") else 0
    mock_get_redis.return_value = redis

    assert has_hud_overlay_connected("76561199000000001") is True
    redis.exists.assert_called_once_with("ac:hud:conn:76561199000000001")
    assert is_hud_sse_active("76561199000000001") is True
    assert mock_get_redis.call_count == 1


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", False)
@patch("core.redis_client.get_redis_client")
def test_has_hud_overlay_connected_false_when_key_missing(mock_get_redis):
    redis = MagicMock()
    redis.exists.return_value = 0
    mock_get_redis.return_value = redis

    assert has_hud_overlay_connected("76561199000000001") is False
    assert is_hud_sse_active("76561199000000001") is True
