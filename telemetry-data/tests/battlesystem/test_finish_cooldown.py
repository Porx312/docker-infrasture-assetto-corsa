import time

from engines.battlesystem.config import FINISHED_COOLDOWN_SEC, MIN_LAP_PROGRESS_BEFORE_FINISH
from engines.battlesystem.state_machine import _handle_finished_cooldown, _handle_idle
from tests.battlesystem.conftest import seed_car


def test_min_lap_progress_is_fraction_not_full_track():
    assert 0.0 < MIN_LAP_PROGRESS_BEFORE_FINISH < 1.0


def test_finished_waits_rematch_cooldown_before_idle(pair_manager):
    pair_manager.state = "FINISHED"
    now = time.time()
    pair_manager.finished_time = now - (FINISHED_COOLDOWN_SEC - 1.0)
    pair_manager.is_battle_server = True
    ended = []

    car1 = seed_car(pair_manager, "guid_a", speed=80, pos=(0, 0, 0))
    car2 = seed_car(pair_manager, "guid_b", speed=80, pos=(5, 0, 0))

    _handle_finished_cooldown(pair_manager, car1, car2, now)
    assert pair_manager.state == "FINISHED"
    assert ended == []

    from engines.battlesystem.config import ARM_SUSTAINED_PROXIMITY_SEC

    pair_manager.arm_proximity_since = time.time() - (ARM_SUSTAINED_PROXIMITY_SEC - 1.0)
    _handle_idle(pair_manager, car1, car2, 5.0, now)
    assert pair_manager.state == "FINISHED"

    pair_manager.on_battle_end = lambda: ended.append(True)
    after = now + FINISHED_COOLDOWN_SEC + 0.1
    _handle_finished_cooldown(pair_manager, car1, car2, after)
    assert pair_manager.state == "IDLE"
    assert ended == [True]
