import time

from engines.battlesystem.config import BATTLE_ARM_MIN_SPEED_KMH, FINISHED_COOLDOWN_SEC
from engines.battlesystem.models import CarState
from engines.battlesystem.orchestrator import BattleManager


def _seed_orchestrator_car(manager, guid, pos, speed=None):
    car = CarState(guid)
    car.pos = pos
    car.speed = speed if speed is not None else (BATTLE_ARM_MIN_SPEED_KMH + 10.0)
    car.last_update_time = time.time()
    manager.cars[guid] = car


def test_release_pair_allows_new_opponent_immediately():
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "guid_a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "guid_b", (19.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "guid_c", (1.0, 0.0, 0.0))

    key_ab = manager._pair_key("guid_a", "guid_b")
    manager.pair_managers[key_ab] = manager._build_pair_manager("guid_a", "guid_b")
    manager.guid_to_pair["guid_a"] = key_ab
    manager.guid_to_pair["guid_b"] = key_ab

    manager._release_pair(key_ab, apply_rematch_cooldown=True)
    manager._try_matchmake()

    assert manager.guid_to_pair.get("guid_a") == manager._pair_key("guid_a", "guid_c")
    assert manager.guid_to_pair.get("guid_c") == manager._pair_key("guid_a", "guid_c")
    assert "guid_b" not in manager.guid_to_pair


def test_cooldown_blocks_same_pair_until_expiration():
    manager = BattleManager()
    manager.set_server_mode(True)
    _seed_orchestrator_car(manager, "guid_a", (0.0, 0.0, 0.0))
    _seed_orchestrator_car(manager, "guid_b", (10.0, 0.0, 0.0))

    key_ab = manager._pair_key("guid_a", "guid_b")
    manager.recent_pair_cooldowns[key_ab] = time.time() + FINISHED_COOLDOWN_SEC

    manager._try_matchmake()
    assert "guid_a" not in manager.guid_to_pair
    assert "guid_b" not in manager.guid_to_pair

    manager.recent_pair_cooldowns[key_ab] = time.time() - 0.1
    manager._try_matchmake()
    assert manager.guid_to_pair.get("guid_a") == key_ab
    assert manager.guid_to_pair.get("guid_b") == key_ab
