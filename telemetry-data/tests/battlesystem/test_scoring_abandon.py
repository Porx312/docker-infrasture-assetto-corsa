import time

from engines.battlesystem.scoring import finalize_abandon
from tests.battlesystem.conftest import seed_car


def test_stall_abandon_cancels_at_zero_zero_without_200m(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time()
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    seed_car(pair_manager, "guid_a", driven=0.02)
    seed_car(pair_manager, "guid_b", driven=0.01)
    hud_calls = []
    pair_manager.on_hud_update = lambda _mgr, **kwargs: hud_calls.append(kwargs)

    assert finalize_abandon(pair_manager, "guid_a", "opponent_stalled") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.finished_time > 0
    assert pair_manager.battle.winner is None
    assert any(call.get("hud_state") == "cancelled" for call in hud_calls)


def test_gap_abandon_cancels_at_zero_zero(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time()
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    seed_car(pair_manager, "guid_a", driven=0.05)
    seed_car(pair_manager, "guid_b", driven=0.03)
    ended = []
    hud_calls = []

    pair_manager.on_battle_end = lambda: ended.append(True)
    pair_manager.on_hud_update = lambda _mgr, **kwargs: hud_calls.append(kwargs)

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.finished_time > 0
    assert ended == []
    assert any(call.get("hud_state") == "cancelled" for call in hud_calls)
    assert pair_manager.battle.winner is None


def test_gap_abandon_win_at_zero_zero_with_progress(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    seed_car(pair_manager, "guid_a", driven=0.70)
    seed_car(pair_manager, "guid_b", driven=0.20)
    hud_calls = []
    pair_manager.on_hud_update = lambda _mgr, **kwargs: hud_calls.append(kwargs)

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.battle.winner == "guid_a"
    assert any(call.get("hud_state") == "finished" for call in hud_calls)


def test_gap_abandon_win_when_any_points(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 1

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.battle.winner == "guid_a"


def test_gap_abandon_win_with_multiple_points(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 2
    pair_manager.battle.car2_score = 0

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.battle.winner == "guid_a"
