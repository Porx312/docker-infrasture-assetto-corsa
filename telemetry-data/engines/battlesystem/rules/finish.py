"""Run end and abandon detection."""

from __future__ import annotations

from typing import Optional, Tuple

from engines.battlesystem.config import (
    ABANDON_PULLAWAY_SPEED_DELTA_KMH,
    DISAPPEAR_GAP_METERS,
    FINISH_POINT_MIN_GAP_METERS,
    GAP_ABORT_MIN_BOTH_SPEED_KMH,
    RUN_END_SPLINE_FRACTION,
)
from engines.battlesystem.rules.proximity import distance_3d, is_ahead_on_track


def run_end_driven_threshold() -> float:
    """Spline progress required to end the run (1.0 = full lap)."""
    if RUN_END_SPLINE_FRACTION >= 0.999:
        return 0.995
    return RUN_END_SPLINE_FRACTION


def check_abandon_by_gap(
    manager,
    lead_car,
    chase_car,
    distance: float,
) -> Optional[str]:
    """
  When gap >= 250 m, return the guid that should win (non-abandoner).

  - Stopped / very slow → that driver abandoned.
  - Lead clearly faster ahead on track → lead left; chase wins.
  - Otherwise chase fell behind → lead wins.
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

    if lead_car.speed >= stall and chase_car.speed >= stall:
        if is_ahead_on_track(lead_car.spline, chase_car.spline):
            if lead_car.speed > chase_car.speed + ABANDON_PULLAWAY_SPEED_DELTA_KMH:
                return chase_guid
            return lead_guid
        if is_ahead_on_track(chase_car.spline, lead_car.spline):
            return lead_guid

    if lead_car.driven_spline >= chase_car.driven_spline:
        return lead_guid
    return chase_guid


def lead_completed_run(lead_car) -> bool:
    """True when the lead has completed the configured fraction of the lap."""
    threshold = run_end_driven_threshold()
    if lead_car.driven_spline >= threshold:
        return True
    # Fallback: crossed the finish line (spline wraps) after most of the lap.
    if lead_car.driven_spline >= 0.75 and (lead_car.spline >= 0.98 or lead_car.spline <= 0.05):
        return True
    return False


def check_run_finish(
    manager,
    lead_car,
    chase_car,
) -> Optional[Tuple[float, bool, Optional[str]]]:
    """
    When lead completes the lap, resolve finish.
    Returns (finish_gap_m, is_draw, point_winner_guid) or None if not finished.

    - gap >= FINISH_POINT_MIN_GAP_METERS: lead gets +1 finish point
    - gap < FINISH_POINT_MIN_GAP_METERS: draw, no finish point
    """
    if not lead_completed_run(lead_car):
        return None
    finish_gap_m = distance_3d(lead_car.pos, chase_car.pos)
    is_draw = finish_gap_m < FINISH_POINT_MIN_GAP_METERS
    if is_draw:
        return finish_gap_m, True, None
    return finish_gap_m, False, manager.battle.lead_guid
