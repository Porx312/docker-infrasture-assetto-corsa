"""Matchmaking gated on acceptBattle user pref."""

import time
from unittest.mock import MagicMock, patch

from core.user_prefs import accept_battle_redis_key, reset_user_prefs_cache_for_tests
from engines.battlesystem.config import BATTLE_ARM_MIN_SPEED_KMH
from engines.battlesystem.models import CarState
from engines.battlesystem.orchestrator import BattleManager


def _seed_orchestrator_car(manager, guid, pos, speed=None):
    car = CarState(guid)
    car.pos = pos
    car.speed = speed if speed is not None else (BATTLE_ARM_MIN_SPEED_KMH + 10.0)
    car.last_update_time = time.time()
    manager.cars[guid] = car


@patch("engines.battlesystem.orchestrator.filter_battle_accept_eligible")
@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", False)
def test_matchmake_skips_players_with_accept_battle_off(mock_filter):
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    mock_filter.return_value = {"steam-a"}
    manager._try_matchmake()

    assert "steam-a" not in manager.guid_to_pair
    assert "steam-b" not in manager.guid_to_pair


@patch("engines.battlesystem.orchestrator.settings")
@patch("engines.battlesystem.orchestrator.filter_battle_accept_eligible")
@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", False)
def test_matchmake_notifies_when_opponent_declines_battle(mock_filter, mock_settings):
    mock_settings.BATTLE_CHAT_ENABLED = True
    mock_settings.BATTLE_DECLINED_NOTIFY_ENABLED = True
    mock_settings.BATTLE_DECLINED_NOTIFY_COOLDOWN_SEC = 30.0
    mock_settings.BATTLE_DECLINED_OPPONENT_MESSAGE = "{player} don't accept battles."

    manager = BattleManager()
    manager.set_server_mode(True)
    manager.player_names = {"steam-a": "Alice", "steam-b": "Bob"}
    chats: list[tuple[str, str]] = []
    manager.on_chat_message = lambda guid, message: chats.append((guid, message))

    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    mock_filter.return_value = {"steam-a"}
    manager._try_matchmake()

    assert len(chats) == 1
    assert chats[0] == ("steam-a", "Bob don't accept battles.")
    assert "steam-a" not in manager.guid_to_pair
    assert "steam-b" not in manager.guid_to_pair


@patch("engines.battlesystem.orchestrator.settings")
@patch("engines.battlesystem.orchestrator.filter_battle_accept_eligible")
@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", False)
def test_matchmake_declined_notify_respects_cooldown(mock_filter, mock_settings):
    mock_settings.BATTLE_CHAT_ENABLED = True
    mock_settings.BATTLE_DECLINED_NOTIFY_ENABLED = True
    mock_settings.BATTLE_DECLINED_NOTIFY_COOLDOWN_SEC = 60.0
    mock_settings.BATTLE_DECLINED_OPPONENT_MESSAGE = "{player} don't accept battles."

    manager = BattleManager()
    manager.set_server_mode(True)
    manager.player_names = {"steam-a": "Alice", "steam-b": "Bob"}
    chats: list[tuple[str, str]] = []
    manager.on_chat_message = lambda guid, message: chats.append((guid, message))

    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))
    mock_filter.return_value = {"steam-a"}

    manager._try_matchmake()
    manager._try_matchmake()

    assert len(chats) == 1


@patch("engines.battlesystem.orchestrator.filter_battle_accept_eligible")
@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", False)
def test_matchmake_pairs_when_both_accept_battle(mock_filter):
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    mock_filter.return_value = {"steam-a", "steam-b"}
    manager._try_matchmake()

    key = manager._pair_key("steam-a", "steam-b")
    assert manager.guid_to_pair.get("steam-a") == key
    assert manager.guid_to_pair.get("steam-b") == key


@patch("core.user_prefs.settings")
@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", False)
def test_matchmake_excludes_declined_via_redis_mget(mock_settings):
    """End-to-end: Redis acceptBattle=0 → filter_battle_accept_eligible → no pairing."""
    mock_settings.REDIS_HOST = "localhost"
    reset_user_prefs_cache_for_tests()

    mock_redis = MagicMock()
    mock_redis.mget.return_value = [None, b"0"]

    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    with patch("core.redis_client.get_redis_client", return_value=mock_redis):
        manager._try_matchmake()

    assert "steam-a" not in manager.guid_to_pair
    assert "steam-b" not in manager.guid_to_pair
    mock_redis.mget.assert_called_once_with(
        [accept_battle_redis_key("steam-a"), accept_battle_redis_key("steam-b")]
    )


@patch("core.user_prefs.settings")
@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", False)
def test_matchmake_pairs_when_redis_mget_both_accept(mock_settings):
    """End-to-end: Redis defaults (None) → both eligible → pair created."""
    mock_settings.REDIS_HOST = "localhost"
    reset_user_prefs_cache_for_tests()

    mock_redis = MagicMock()
    mock_redis.mget.return_value = [None, None]

    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    with patch("core.redis_client.get_redis_client", return_value=mock_redis):
        manager._try_matchmake()

    key = manager._pair_key("steam-a", "steam-b")
    assert manager.guid_to_pair.get("steam-a") == key
    assert manager.guid_to_pair.get("steam-b") == key
    mock_redis.mget.assert_called_once()
