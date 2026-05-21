import time

from engines.battlesystem.config import ARM_SUSTAINED_PROXIMITY_SEC
from engines.battlesystem.rules import arming
from engines.battlesystem.state_machine import process_pair_logic
from tests.battlesystem.conftest import seed_car


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
    messages = []
    pair_manager.on_chat_message = lambda _g, msg, **_: messages.append(msg)
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=50.0)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=50.0)

    process_pair_logic(pair_manager)

    assert pair_manager.state == "IDLE"
    assert pair_manager.arm_proximity_since > 0.0
    assert any("BATTLE ARM 5" in m and "brake: cancel" in m and "15m" in m for m in messages)


def test_idle_requires_sustained_proximity_before_armed(pair_manager):
    pair_manager.state = "IDLE"
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=50.0)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=50.0)
    now = time.time()

    pair_manager.arm_proximity_since = now - (ARM_SUSTAINED_PROXIMITY_SEC - 1.0)
    process_pair_logic(pair_manager)
    assert pair_manager.state == "IDLE"

    pair_manager.arm_proximity_since = now - (ARM_SUSTAINED_PROXIMITY_SEC + 0.1)
    process_pair_logic(pair_manager)
    assert pair_manager.state == "ARMED"


def test_idle_resets_proximity_timer_when_cars_separate(pair_manager):
    pair_manager.state = "IDLE"
    messages = []
    pair_manager.on_chat_message = lambda _g, msg, **_: messages.append(msg)
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=50.0)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=50.0)

    process_pair_logic(pair_manager)
    assert pair_manager.arm_proximity_since > 0.0

    seed_car(pair_manager, "guid_b", pos=(25, 0, 0), speed=50.0)
    process_pair_logic(pair_manager)

    assert pair_manager.state == "IDLE"
    assert pair_manager.arm_proximity_since == 0.0
    assert any("BATTLE CANCELLED" in m for m in messages)
