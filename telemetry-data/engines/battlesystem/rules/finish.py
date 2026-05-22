"""Run end and abandon detection."""

from __future__ import annotations

from typing import Optional, Tuple

from engines.battlesystem.config import (
    ABANDON_STALL_SEC,
    DISAPPEAR_GAP_METERS,
    FINISH_POINT_MIN_GAP_METERS,
    GAP_ABORT_MIN_BOTH_SPEED_KMH,
)
from engines.battlesystem.rules.proximity import (
    distance_3d,
    is_ahead_with_fallback,
    pair_uses_position_fallback_from_manager,
)


def check_abandon_by_stall(
    manager,
    lead_car,
    chase_car,
    now: float,
) -> Optional[str]:
    """
    Opponent stopped / in pits: no minimum 3D gap required.
    Winner is the driver still moving after ABANDON_STALL_SEC below speed threshold.
    """
    min_speed = GAP_ABORT_MIN_BOTH_SPEED_KMH
    lead_guid = manager.battle.lead_guid
    chase_guid = manager.battle.chase_guid

    lead_stalled = lead_car.stall_duration_sec(now) >= ABANDON_STALL_SEC
    chase_stalled = chase_car.stall_duration_sec(now) >= ABANDON_STALL_SEC

    if lead_stalled and chase_car.speed >= min_speed:
        return chase_guid
    if chase_stalled and lead_car.speed >= min_speed:
        return lead_guid
    return None


def check_abandon_by_gap(
    manager,
    lead_car,
    chase_car,
    distance: float,
) -> Optional[str]:
    """
    When gap >= 250 m, return the guid that should win (driver still in the battle).

    - Stopped / very slow → that driver abandoned; the other wins.
    - Both still moving → whoever is ahead on track wins (the follower fell behind /
      disappeared from the battle). Tie on track → more run progress (driven_spline).
    """
    if distance < DISAPPEAR_GAP_METERS:
        return None

    lead_guid = manager.battle.lead_guid
    chase_guid = manager.battle.chase_guid
    stall = GAP_ABORT_MIN_BOTH_SPEED_KMH

    if lead_car.speed < stall and chase_car.speed >= stall:
        return chase_guid
    if chase_car.speed < stall and lead_car.speed >= stall:
        return lead_guid

    if is_ahead_with_fallback(lead_car, chase_car, manager=manager):
        return lead_guid
    if is_ahead_with_fallback(chase_car, lead_car, manager=manager):
        return chase_guid

    if pair_uses_position_fallback_from_manager(manager):
        if lead_car.driven_distance_m > chase_car.driven_distance_m:
            return lead_guid
        if chase_car.driven_distance_m > lead_car.driven_distance_m:
            return chase_guid
    elif lead_car.driven_spline > chase_car.driven_spline:
        return lead_guid
    elif chase_car.driven_spline > lead_car.driven_spline:
        return chase_guid
    return lead_guid


def lead_completed_run(lead_car) -> bool:
    """True when the lead completed a full lap (finish line / LAP_COMPLETED)."""
    return bool(getattr(lead_car, "run_lap_completed", False))


def check_run_finish(
    manager,
    lead_car,
    chase_car,
) -> Optional[Tuple[float, bool, Optional[str]]]:
    """
    When lead completes a lap, resolve finish.
    Returns (finish_gap_m, is_draw, point_winner_guid) or None if not finished.

    - gap < FINISH_POINT_MIN_GAP_METERS: draw, no finish point
    - gap >= threshold and clearly ahead on track: +1 to the driver ahead
    - tied on track: draw even if 3D gap is large
    """
    if not lead_completed_run(lead_car):
        return None

    lead_guid = manager.battle.lead_guid
    chase_guid = manager.battle.chase_guid
    finish_gap_m = distance_3d(lead_car.pos, chase_car.pos)

    if finish_gap_m < FINISH_POINT_MIN_GAP_METERS:
        return finish_gap_m, True, None

    if is_ahead_with_fallback(lead_car, chase_car, manager=manager):
        return finish_gap_m, False, lead_guid
    if is_ahead_with_fallback(chase_car, lead_car, manager=manager):
        return finish_gap_m, False, chase_guid

    return finish_gap_m, True, None
