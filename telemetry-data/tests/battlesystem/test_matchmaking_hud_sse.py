"""Matchmaking gated on HUD SSE presence."""

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


@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", True)
@patch("engines.battlesystem.orchestrator.filter_hud_eligible")
def test_matchmake_skips_players_without_hud_sse(mock_filter):
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    mock_filter.return_value = {"steam-a"}
    manager._try_matchmake()

    assert "steam-a" not in manager.guid_to_pair
    assert "steam-b" not in manager.guid_to_pair


@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", True)
@patch("engines.battlesystem.orchestrator.filter_hud_eligible")
def test_matchmake_pairs_when_both_have_hud_sse(mock_filter):
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    mock_filter.return_value = {"steam-a", "steam-b"}
    manager._try_matchmake()

    key = manager._pair_key("steam-a", "steam-b")
    assert manager.guid_to_pair.get("steam-a") == key
    assert manager.guid_to_pair.get("steam-b") == key


@patch("engines.battlesystem.orchestrator.BATTLE_REQUIRE_HUD_SSE", True)
@patch("engines.battlesystem.orchestrator.is_hud_sse_active")
@patch("engines.battlesystem.orchestrator.dissolve_pair")
def test_update_dissolves_pair_when_hud_sse_lost(mock_dissolve, mock_active):
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "steam-a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "steam-b", (10.0, 0.0, 0.0))

    key = manager._pair_key("steam-a", "steam-b")
    mgr = manager._build_pair_manager("steam-a", "steam-b")
    manager.pair_managers[key] = mgr
    manager.guid_to_pair["steam-a"] = key
    manager.guid_to_pair["steam-b"] = key

    mock_active.side_effect = lambda guid: guid == "steam-a"

    manager.update("steam-a", 0.1, 60.0, (0.0, 0.0, 0.0))

    mock_dissolve.assert_called_once()
    assert mock_dissolve.call_args.args[0] is mgr
    assert mock_dissolve.call_args.kwargs["reason"] == "hud_disconnected"
    assert key not in manager.pair_managers
