import time

from engines.battlesystem.config import (
    BATTLE_ARM_MAX_GAP_METERS,
    PAIR_IDLE_SEPARATED_RELEASE_SEC,
    PAIR_MAX_PREACTIVE_LOCK_SEC,
)
from engines.battlesystem.state_machine import _handle_idle, process_pair_logic
from tests.battlesystem.conftest import seed_car


def test_idle_separation_dissolves_pair_without_rematch_cooldown(pair_manager):
    pair_manager.pair_locked_at = time.time()
    ended = []
    pair_manager.on_battle_end = lambda rematch_cooldown=False: ended.append(rematch_cooldown)

    car1 = seed_car(pair_manager, "guid_a", speed=80, pos=(0, 0, 0))
    too_far = BATTLE_ARM_MAX_GAP_METERS + 30.0
    car2 = seed_car(pair_manager, "guid_b", speed=80, pos=(too_far, 0, 0))
    now = time.time()

    _handle_idle(pair_manager, car1, car2, too_far, now)
    assert pair_manager.battle is not None
    assert ended == []

    _handle_idle(pair_manager, car1, car2, too_far, now + PAIR_IDLE_SEPARATED_RELEASE_SEC + 0.1)
    assert pair_manager.battle is None
    assert ended == [False]


def test_preactive_lock_timeout_dissolves_pair(pair_manager):
    pair_manager.state = "ARMED"
    pair_manager.pair_locked_at = time.time() - (PAIR_MAX_PREACTIVE_LOCK_SEC + 1.0)
    ended = []
    pair_manager.on_battle_end = lambda rematch_cooldown=False: ended.append(rematch_cooldown)

    seed_car(pair_manager, "guid_a", speed=80, pos=(0, 0, 0))
    seed_car(pair_manager, "guid_b", speed=80, pos=(10, 0, 0))

    process_pair_logic(pair_manager)

    assert pair_manager.battle is None
    assert ended == [False]
