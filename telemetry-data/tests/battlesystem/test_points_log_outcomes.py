from unittest.mock import patch

from engines.battlesystem.scoring import finalize_abandon, finalize_single_session_result
from tests.battlesystem.conftest import seed_car


def test_session_draw_dispatches_with_draw_status(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle_id = "battle-draw-test"
    pair_manager.battle.car1_score = 1
    pair_manager.battle.car2_score = 1
    pair_manager.battle.points_log = [
        {"scorer": "guid_a", "reason": "overtake", "ts": 1},
    ]
    seed_car(pair_manager, "guid_a")
    seed_car(pair_manager, "guid_b")
    dispatched = []
    pair_manager.on_score_update = lambda *args: dispatched.append(args)

    finalize_single_session_result(pair_manager, finish_gap_m=15.0, is_draw=True)

    assert dispatched
    assert dispatched[0][-1] == "draw"
    assert dispatched[0][3] is None  # winner_guid


def test_cancelled_abandon_does_not_dispatch(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle_id = "battle-cancel-test"
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    seed_car(pair_manager, "guid_a", driven=0.02)
    seed_car(pair_manager, "guid_b", driven=0.01)
    dispatched = []
    pair_manager.on_score_update = lambda *args: dispatched.append(args)

    assert finalize_abandon(pair_manager, "guid_a", "opponent_stalled") is True
    assert dispatched == []
