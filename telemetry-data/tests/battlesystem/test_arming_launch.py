import time
from unittest.mock import patch

from engines.battlesystem.config import (
    ARM_SUSTAINED_PROXIMITY_SEC,
    BATTLE_ARM_CANCEL_SPEED_KMH,
    BATTLE_ARM_MIN_SPEED_KMH,
    POSITION_ROLE_ASSIGN_WAIT_SEC,
)
from engines.battlesystem.rules import arming
from engines.battlesystem.state_machine import process_pair_logic
from tests.battlesystem.conftest import seed_car

ARMING_TEST_SPEED = BATTLE_ARM_CANCEL_SPEED_KMH + 5.0


def test_can_assign_roles_after_wait_even_if_splines_tied(pair_manager):
    car1 = seed_car(pair_manager, "guid_a", spline=0.30, speed=50.0)
    car2 = seed_car(pair_manager, "guid_b", spline=0.3002, speed=50.0)
    started = time.time() - 10.0

    ok, reason = arming.can_assign_roles(car1, car2, started, time.time())
    assert ok is True
    assert reason == ""


def test_can_launch_uses_inclusive_speed_threshold(pair_manager):
    car1 = seed_car(pair_manager, "guid_a", speed=40.0)
    car2 = seed_car(pair_manager, "guid_b", speed=40.0)
    assert arming.can_launch(car1, car2) is True


def test_idle_starts_proximity_timer_without_armed(pair_manager):
    pair_manager.state = "IDLE"
    hud_calls = []
    pair_manager.on_hud_update = lambda _mgr, **kwargs: hud_calls.append(kwargs)
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=ARMING_TEST_SPEED)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=ARMING_TEST_SPEED)

    process_pair_logic(pair_manager)

    assert pair_manager.state == "IDLE"
    assert pair_manager.arm_proximity_since > 0.0
    assert any(call.get("hud_state") == "arming" for call in hud_calls)


def test_idle_requires_sustained_proximity_before_armed(pair_manager):
    pair_manager.state = "IDLE"
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=ARMING_TEST_SPEED)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=ARMING_TEST_SPEED)
    now = time.time()

    pair_manager.arm_proximity_since = now - (ARM_SUSTAINED_PROXIMITY_SEC - 1.0)
    process_pair_logic(pair_manager)
    assert pair_manager.state == "IDLE"

    pair_manager.arm_proximity_since = now - (ARM_SUSTAINED_PROXIMITY_SEC + 0.1)
    process_pair_logic(pair_manager)
    assert pair_manager.state == "ARMED"


def test_idle_resets_proximity_timer_when_cars_separate(pair_manager):
    from engines.battlesystem.config import BATTLE_ARM_ABORT_GAP_METERS, BATTLE_ARM_ABORT_GRACE_SEC

    pair_manager.state = "IDLE"
    hud_calls = []
    pair_manager.on_hud_update = lambda _mgr, **kwargs: hud_calls.append(kwargs)
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=ARMING_TEST_SPEED)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=ARMING_TEST_SPEED)

    process_pair_logic(pair_manager)
    assert pair_manager.arm_proximity_since > 0.0

    too_far = BATTLE_ARM_ABORT_GAP_METERS + 2.0
    seed_car(pair_manager, "guid_b", pos=(too_far, 0, 0), speed=ARMING_TEST_SPEED)
    pair_manager._arming_violation_since = time.time() - (BATTLE_ARM_ABORT_GRACE_SEC + 0.1)
    pair_manager._arming_countdown_announced_sec = 5
    process_pair_logic(pair_manager)

    assert pair_manager.state == "IDLE"
    assert pair_manager.arm_proximity_since == 0.0
    assert any(call.get("hud_state") == "cancelled" for call in hud_calls)


def test_arming_abort_suppresses_debounced_hud_during_cancel_hold(pair_manager):
    from engines.battlesystem.config import BATTLE_ARM_ABORT_GAP_METERS, BATTLE_ARM_ABORT_GRACE_SEC

    pair_manager.state = "IDLE"
    hud_calls = []
    pair_manager.on_hud_update = lambda _mgr, **kwargs: hud_calls.append(kwargs)
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=ARMING_TEST_SPEED)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=ARMING_TEST_SPEED)

    process_pair_logic(pair_manager)
    hud_calls.clear()

    too_far = BATTLE_ARM_ABORT_GAP_METERS + 2.0
    seed_car(pair_manager, "guid_b", pos=(too_far, 0, 0), speed=ARMING_TEST_SPEED)
    pair_manager._arming_violation_since = time.time() - (BATTLE_ARM_ABORT_GRACE_SEC + 0.1)
    pair_manager._arming_countdown_announced_sec = 5
    process_pair_logic(pair_manager)

    cancelled = [c for c in hud_calls if c.get("hud_state") == "cancelled"]
    assert len(cancelled) >= 1
    assert cancelled[0].get("force") is True
    non_force = [c for c in hud_calls if not c.get("force")]
    assert non_force == []
    assert pair_manager._hud_cancel_hold_until > time.time()


def test_can_assign_roles_position_fallback_after_short_wait(pair_manager):
    car1 = seed_car(pair_manager, "guid_a", spline=0.0, speed=50.0, pos=(0, 0, 0))
    car2 = seed_car(pair_manager, "guid_b", spline=0.0, speed=50.0, pos=(5, 0, 0))
    car1.spline_reliable = False
    car2.spline_reliable = False
    started = time.time() - (POSITION_ROLE_ASSIGN_WAIT_SEC + 0.1)

    ok, reason = arming.can_assign_roles(car1, car2, started, time.time())
    assert ok is True
    assert reason == ""


def test_launching_reaches_active_when_speed_dips_after_go(pair_manager):
    pair_manager.state = "LAUNCHING"
    pair_manager.launch_trigger_time = time.time() - 1.0
    pair_manager.battle.lead_guid = None
    pair_manager.battle.chase_guid = None

    lead = seed_car(pair_manager, "guid_a", spline=0.0, speed=15.0, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", spline=0.0, speed=15.0, pos=(10, 0, 0))
    lead.spline_reliable = False
    chase.spline_reliable = False
    lead.vel = (10.0, 0.0, 0.0)
    chase.vel = (8.0, 0.0, 0.0)

    process_pair_logic(pair_manager)

    assert pair_manager.state == "ACTIVE"
    assert pair_manager.battle.lead_guid is not None
    assert pair_manager.battle.chase_guid is not None


def test_armed_transitions_to_launching(pair_manager):
    pair_manager.state = "ARMED"
    pair_manager.condition_start_time = time.time()
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=ARMING_TEST_SPEED)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=ARMING_TEST_SPEED)

    with patch(
        "engines.battlesystem.state_machine.BATTLE_ARM_MIN_SPEED_KMH",
        22.0,
    ):
        process_pair_logic(pair_manager)

    assert pair_manager.state == "LAUNCHING"
