"""Arming and launch preconditions."""

from __future__ import annotations

from engines.battlesystem.config import (
    BATTLE_ARM_MAX_GAP_METERS,
    BATTLE_ARM_MIN_SPEED_KMH,
    GAP_ABORT_MIN_BOTH_SPEED_KMH,
    MAX_BATTLE_GAP_METERS,
    PRESTART_GAP_ABORT_GRACE_SEC,
    ROLE_ASSIGN_MIN_GAP_SPLINE,
    ROLE_ASSIGN_WAIT_SEC,
)
from engines.battlesystem.rules.overtake import reset_overtake_tracking
from engines.battlesystem.rules.proximity import assign_lead_chase, distance_3d, is_within_battle_gap


def can_arm(car1, car2) -> bool:
    if not is_within_battle_gap(car1.pos, car2.pos, BATTLE_ARM_MAX_GAP_METERS):
        return False
    return car1.speed > BATTLE_ARM_MIN_SPEED_KMH and car2.speed > BATTLE_ARM_MIN_SPEED_KMH


def can_launch(car1, car2) -> bool:
    return car1.speed > BATTLE_ARM_MIN_SPEED_KMH and car2.speed > BATTLE_ARM_MIN_SPEED_KMH


def should_abort_prestart(distance: float, car1, car2, started_at: float, now: float) -> bool:
    both_moving = (
        car1.speed >= GAP_ABORT_MIN_BOTH_SPEED_KMH
        and car2.speed >= GAP_ABORT_MIN_BOTH_SPEED_KMH
    )
    return (
        distance > MAX_BATTLE_GAP_METERS
        and both_moving
        and (now - started_at) >= PRESTART_GAP_ABORT_GRACE_SEC
    )


def can_assign_roles(car1, car2, launch_started_at: float, now: float) -> tuple[bool, str]:
    """
    Validate lead/chase can be assigned at launch.
    Returns (ok, abort_reason).
    """
    c1_ahead = (car1.spline - car2.spline) % 1.0
    c2_ahead = (car2.spline - car1.spline) % 1.0
    clear_gap = min(c1_ahead, c2_ahead)
    if clear_gap >= ROLE_ASSIGN_MIN_GAP_SPLINE:
        return True, ""
    if (now - launch_started_at) <= ROLE_ASSIGN_WAIT_SEC:
        return False, ""
    return False, "leader_not_clear"


def setup_active_run(manager, car1, car2, now: float) -> None:
    lead_guid, chase_guid = assign_lead_chase(car1, car2)
    manager.battle.lead_guid = lead_guid
    manager.battle.chase_guid = chase_guid
    car1.driven_spline = 0.0
    car2.driven_spline = 0.0
    manager.active_start_time = now
    manager._overtake_chase_scored = False
    manager._last_overtake_point_ts = 0.0
    lead_car = manager.cars[lead_guid]
    chase_car = manager.cars[chase_guid]
    gap = (lead_car.spline - chase_car.spline) % 1.0
    manager.battle.initial_gap_spline = gap if gap < 0.5 else 0.0
    reset_overtake_tracking(manager)
