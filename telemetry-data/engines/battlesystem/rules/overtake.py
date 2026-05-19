"""Overtake and position-recovery scoring."""

from __future__ import annotations

from typing import Optional, Tuple

from engines.battlesystem.config import OVERTAKE_POINT_COOLDOWN_SEC
from engines.battlesystem.rules.proximity import is_ahead_on_track, is_overtake_scoring_gap


def reset_overtake_tracking(manager) -> None:
    """Call when a run becomes ACTIVE."""
    manager._chase_was_ahead_on_track = False
    manager._lead_was_ahead_on_track = False


def try_score_active_points(
    manager,
    lead_car,
    chase_car,
    distance: float,
    now: float,
) -> Optional[Tuple[str, str]]:
    """
    Check overtake / recovery conditions during ACTIVE.
    Returns (winner_guid, reason) or None.
    """
    if (now - manager.active_start_time) <= manager._overtake_active_grace_sec:
        return None
    if (now - manager._last_overtake_point_ts) < OVERTAKE_POINT_COOLDOWN_SEC:
        return None
    if not is_overtake_scoring_gap(distance):
        manager._chase_was_ahead_on_track = is_ahead_on_track(
            chase_car.spline, lead_car.spline, manager.overtake_pass_margin_spline
        )
        manager._lead_was_ahead_on_track = is_ahead_on_track(
            lead_car.spline, chase_car.spline, manager.overtake_pass_margin_spline
        )
        return None

    pass_margin = manager.overtake_pass_margin_spline
    chase_ahead = is_ahead_on_track(chase_car.spline, lead_car.spline, pass_margin)
    lead_ahead = is_ahead_on_track(lead_car.spline, chase_car.spline, pass_margin)

    if not manager._overtake_chase_scored:
        crossed = chase_ahead and not manager._chase_was_ahead_on_track
        if crossed or chase_ahead:
            manager._chase_was_ahead_on_track = chase_ahead
            manager._lead_was_ahead_on_track = lead_ahead
            return manager.battle.chase_guid, "overtake"
    else:
        crossed = lead_ahead and not manager._lead_was_ahead_on_track
        if crossed or lead_ahead:
            manager._chase_was_ahead_on_track = chase_ahead
            manager._lead_was_ahead_on_track = lead_ahead
            return manager.battle.lead_guid, "position_recovery"

    manager._chase_was_ahead_on_track = chase_ahead
    manager._lead_was_ahead_on_track = lead_ahead
    return None
