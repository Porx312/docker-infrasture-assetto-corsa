import time

from engines.battlesystem.config import FINISHED_COOLDOWN_SEC
from engines.battlesystem.rules.finish import run_end_driven_threshold
from engines.battlesystem.state_machine import _handle_finished_cooldown, _handle_idle
from tests.battlesystem.conftest import seed_car


def test_run_end_threshold_is_full_lap():
    assert run_end_driven_threshold() >= 0.995


def test_finished_cooldown_blocks_rearm_and_releases_after_cooldown(pair_manager):
    pair_manager.state = "FINISHED"
    pair_manager.finished_time = time.time()
    pair_manager.is_battle_server = True
    ended = []
    pair_manager.on_battle_end = lambda: ended.append(True)

    car1 = seed_car(pair_manager, "guid_a", speed=80, pos=(0, 0, 0))
    car2 = seed_car(pair_manager, "guid_b", speed=80, pos=(5, 0, 0))

    _handle_idle(pair_manager, car1, car2, 5.0, time.time())
    assert pair_manager.state == "FINISHED"

    pair_manager.finished_time = time.time() - FINISHED_COOLDOWN_SEC - 1
    _handle_finished_cooldown(pair_manager, car1, car2, time.time())
    assert pair_manager.state == "IDLE"
    assert ended == [True]
