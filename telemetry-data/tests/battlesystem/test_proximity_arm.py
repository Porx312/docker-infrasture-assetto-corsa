from engines.battlesystem.config import BATTLE_ARM_MAX_GAP_METERS, BATTLE_ARM_MIN_SPEED_KMH
from engines.battlesystem.rules import arming
from engines.battlesystem.rules.proximity import (
    is_ahead_on_track,
    is_overtake_scoring_gap,
    is_within_battle_gap,
    is_within_overtake_gap,
)
from tests.battlesystem.conftest import seed_car


def test_is_within_battle_gap():
    assert is_within_battle_gap((0, 0, 0), (10, 0, 0), 15.0) is True
    assert is_within_battle_gap((0, 0, 0), (20, 0, 0), 15.0) is False


def test_is_ahead_on_track_with_margin():
    assert is_ahead_on_track(0.31, 0.30, margin=0.005) is True
    assert is_ahead_on_track(0.3005, 0.30, margin=0.005) is False


def test_is_within_overtake_gap():
    assert is_within_overtake_gap((0, 0, 0), (14, 0, 0)) is True
    assert is_within_overtake_gap((0, 0, 0), (16, 0, 0)) is False


def test_is_overtake_scoring_gap():
    assert is_overtake_scoring_gap(12.0) is True
    assert is_overtake_scoring_gap(9.0) is False
    assert is_overtake_scoring_gap(16.0) is False


def test_can_arm_requires_gap_and_speed(pair_manager):
    a = seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=50)
    b = seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=50)
    assert arming.can_arm(a, b) is True

    too_far = BATTLE_ARM_MAX_GAP_METERS + 5.0
    seed_car(pair_manager, "guid_b", pos=(too_far, 0, 0), speed=50)
    assert arming.can_arm(pair_manager.cars["guid_a"], pair_manager.cars["guid_b"]) is False

    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=max(0.0, BATTLE_ARM_MIN_SPEED_KMH - 10.0))
    assert arming.can_arm(pair_manager.cars["guid_a"], pair_manager.cars["guid_b"]) is False
