import time

from engines.battlesystem.scoring import finalize_abandon
from tests.battlesystem.conftest import seed_car


def test_gap_abandon_cancels_at_zero_zero(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time()
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    seed_car(pair_manager, "guid_a", driven=0.05)
    seed_car(pair_manager, "guid_b", driven=0.03)
    ended = []

    pair_manager.on_battle_end = lambda: ended.append(True)
    messages = []
    pair_manager.on_chat_message = lambda _g, msg, **_: messages.append(msg)

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "IDLE"
    assert ended == [True]
    assert any("CANCELLED" in m for m in messages)
    assert pair_manager.battle.winner is None


def test_gap_abandon_win_at_zero_zero_with_progress(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    seed_car(pair_manager, "guid_a", driven=0.70)
    seed_car(pair_manager, "guid_b", driven=0.20)
    messages = []
    pair_manager.on_chat_message = lambda _g, msg, **_: messages.append(msg)

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.battle.winner == "guid_a"
    assert any("WIN" in m and "abandoned" in m for m in messages)


def test_gap_abandon_win_when_any_points(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 1
    pair_manager.on_chat_message = None

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.battle.winner == "guid_a"


def test_gap_abandon_win_with_multiple_points(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 2
    pair_manager.battle.car2_score = 0
    pair_manager.on_chat_message = None

    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.state == "FINISHED"
    assert pair_manager.battle.winner == "guid_a"
