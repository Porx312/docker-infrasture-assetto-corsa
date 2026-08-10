"""Matchmaking gated on acceptBattle user pref."""

import time
from unittest.mock import patch

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
