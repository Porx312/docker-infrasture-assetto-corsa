"""Integration tests for arming countdown grace and hysteresis."""

import time

from engines.battlesystem.config import (
    ARM_SUSTAINED_PROXIMITY_SEC,
    BATTLE_ARM_ABORT_GAP_METERS,
    BATTLE_ARM_ABORT_GRACE_SEC,
    BATTLE_ARM_CANCEL_SPEED_KMH,
    BATTLE_ARM_MAX_GAP_METERS,
)
from engines.battlesystem.state_machine import process_pair_logic
from tests.battlesystem.conftest import seed_car


def test_arming_countdown_survives_brief_gap_opening(pair_manager):
    """Gap between arm and abort thresholds keeps countdown running."""
    gap_between = BATTLE_ARM_MAX_GAP_METERS + 1.0
    if gap_between > BATTLE_ARM_ABORT_GAP_METERS:
        gap_between = BATTLE_ARM_ABORT_GAP_METERS - 0.5
    assert gap_between > BATTLE_ARM_MAX_GAP_METERS
    speed = BATTLE_ARM_CANCEL_SPEED_KMH + 5
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=speed)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=speed)

    now = time.time()
    pair_manager.arm_proximity_since = now - 1.0
    pair_manager._arming_countdown_announced_sec = 4

    seed_car(pair_manager, "guid_b", pos=(gap_between, 0, 0), speed=speed)
    process_pair_logic(pair_manager)

    assert pair_manager.arm_proximity_since > 0.0


def test_arming_countdown_aborts_after_grace_when_gap_opens(pair_manager):
    speed = BATTLE_ARM_CANCEL_SPEED_KMH + 5
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=speed)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=speed)

    now = time.time()
    pair_manager.arm_proximity_since = now - 1.0
    pair_manager._arming_countdown_announced_sec = 4

    too_far = BATTLE_ARM_ABORT_GAP_METERS + 2.0
    seed_car(pair_manager, "guid_b", pos=(too_far, 0, 0), speed=speed)
    pair_manager._arming_violation_since = now - (BATTLE_ARM_ABORT_GRACE_SEC + 0.1)

    process_pair_logic(pair_manager)

    assert pair_manager.arm_proximity_since == 0.0


def test_arming_reaches_armed_after_sustained_proximity(pair_manager):
    speed = BATTLE_ARM_CANCEL_SPEED_KMH + 5
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=speed)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=speed)

    now = time.time()
    pair_manager.arm_proximity_since = now - (ARM_SUSTAINED_PROXIMITY_SEC + 0.1)
    process_pair_logic(pair_manager)

    assert pair_manager.state == "ARMED"
    assert pair_manager.arm_proximity_since == 0.0
