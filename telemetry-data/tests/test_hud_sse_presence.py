"""Tests for HUD SSE presence gate."""

from unittest.mock import MagicMock, patch

import pytest

from core import settings
from core.hud_sse_presence import (
    filter_hud_eligible,
    has_hud_overlay_connected,
    hud_sse_redis_key,
    is_hud_sse_active,
    reset_hud_sse_presence_cache_for_tests,
)


@pytest.fixture(autouse=True)
def _clear_cache():
    reset_hud_sse_presence_cache_for_tests()
    yield
    reset_hud_sse_presence_cache_for_tests()


def test_hud_sse_redis_key():
    assert hud_sse_redis_key("76561199000000001") == "ac:hud:sse:76561199000000001"


@patch("core.hud_sse_presence.settings.BATTLE_REQUIRE_HUD_SSE", True)
@patch("core.redis_client.get_redis_client")
def test_is_hud_sse_active_reads_redis(mock_get_redis):
    redis = MagicMock()
    redis.exists.return_value = 1
    mock_get_redis.return_value = redis

    assert is_hud_sse_active("76561199000000001") is True
    redis.exists.assert_called_once_with("ac:hud:sse:76561199000000001")


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
    redis.mget.return_value = ["1", None]
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
    redis.exists.return_value = 1
    mock_get_redis.return_value = redis

    assert has_hud_overlay_connected("76561199000000001") is True
    redis.exists.assert_called_once_with("ac:hud:sse:76561199000000001")
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
