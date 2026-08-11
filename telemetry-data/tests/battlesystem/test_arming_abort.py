from engines.battlesystem.config import (
    BATTLE_ARM_ABORT_GAP_METERS,
    BATTLE_ARM_CANCEL_SPEED_KMH,
    BATTLE_ARM_MAX_GAP_METERS,
    BATTLE_ARM_MIN_SPEED_KMH,
)
from engines.battlesystem.rules import arming
from tests.battlesystem.conftest import seed_car


def test_should_abort_arming_when_gap_opens(pair_manager):
    a = seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=60)
    b = seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=60)
    assert arming.should_abort_arming(a, b) is False

    beyond_abort = BATTLE_ARM_ABORT_GAP_METERS + 1.0
    seed_car(pair_manager, "guid_b", pos=(beyond_abort, 0, 0), speed=60)
    assert arming.arming_violation_active(
        pair_manager.cars["guid_a"],
        pair_manager.cars["guid_b"],
    ) is True

    cancel_speed = BATTLE_ARM_CANCEL_SPEED_KMH
    continue_speed = BATTLE_ARM_MIN_SPEED_KMH
    assert cancel_speed >= continue_speed

    a = seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=cancel_speed + 5)
    b = seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=cancel_speed + 5)
    assert arming.can_arm(a, b) is True
    assert arming.should_abort_arming(a, b) is False

    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=cancel_speed - 1)
    assert arming.should_abort_arming(
        pair_manager.cars["guid_a"],
        pair_manager.cars["guid_b"],
    ) is True


def test_gap_hysteresis_between_arm_and_abort(pair_manager):
    """Gap in (arm, abort] cannot arm but does not trigger abort violation."""
    gap_between = BATTLE_ARM_MAX_GAP_METERS + 1.0
    if gap_between > BATTLE_ARM_ABORT_GAP_METERS:
        gap_between = BATTLE_ARM_ABORT_GAP_METERS - 0.5
    assert gap_between > BATTLE_ARM_MAX_GAP_METERS
    a = seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=60)
    b = seed_car(pair_manager, "guid_b", pos=(gap_between, 0, 0), speed=60)
    assert arming.can_arm(a, b) is False
    assert arming.arming_violation_active(a, b) is False


def test_can_arm_requires_cancel_speed_not_min_speed(pair_manager):
    mid_speed = BATTLE_ARM_MIN_SPEED_KMH + 5
    if mid_speed >= BATTLE_ARM_CANCEL_SPEED_KMH:
        return
    a = seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=mid_speed)
    b = seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=mid_speed)
    assert arming.can_arm(a, b) is False
    assert arming.arming_violation_active(a, b) is True
