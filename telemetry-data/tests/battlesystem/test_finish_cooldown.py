import time

from engines.battlesystem.config import MIN_LAP_PROGRESS_BEFORE_FINISH
from engines.battlesystem.state_machine import _handle_finished_state
from tests.battlesystem.conftest import seed_car


def test_min_lap_progress_is_fraction_not_full_track():
    assert 0.0 < MIN_LAP_PROGRESS_BEFORE_FINISH < 1.0


def test_finished_releases_pair_immediately(pair_manager):
    pair_manager.state = "FINISHED"
    pair_manager.is_battle_server = True
    ended = []

    seed_car(pair_manager, "guid_a", speed=80, pos=(0, 0, 0))
    seed_car(pair_manager, "guid_b", speed=80, pos=(5, 0, 0))
    pair_manager.on_battle_end = lambda rematch_cooldown=False: ended.append(rematch_cooldown)

    _handle_finished_state(pair_manager)

    assert pair_manager.state == "IDLE"
    assert pair_manager.battle is None
    assert ended == [True]
