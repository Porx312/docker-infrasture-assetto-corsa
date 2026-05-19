"""Distance and track-position helpers for touge battles."""

from __future__ import annotations

import math
from typing import Tuple

from engines.battlesystem.config import (
    BATTLE_ARM_MAX_GAP_METERS,
    OVERTAKE_MAX_GAP_METERS,
    OVERTAKE_MIN_GAP_METERS,
)


def distance_3d(pos_a: Tuple[float, float, float], pos_b: Tuple[float, float, float]) -> float:
    return math.sqrt(
        (pos_a[0] - pos_b[0]) ** 2
        + (pos_a[1] - pos_b[1]) ** 2
        + (pos_a[2] - pos_b[2]) ** 2
    )


def is_within_battle_gap(
    pos_a: Tuple[float, float, float],
    pos_b: Tuple[float, float, float],
    max_gap_m: float = BATTLE_ARM_MAX_GAP_METERS,
) -> bool:
    """True when cars are close enough to arm or score proximity points."""
    return distance_3d(pos_a, pos_b) <= max_gap_m


def is_within_overtake_gap(
    pos_a: Tuple[float, float, float],
    pos_b: Tuple[float, float, float],
) -> bool:
    return is_within_battle_gap(pos_a, pos_b, OVERTAKE_MAX_GAP_METERS)


def is_overtake_scoring_gap(distance_m: float) -> bool:
    """Overtake/recovery only when cars are 10–15 m apart (clear pass, still same battle)."""
    return OVERTAKE_MIN_GAP_METERS <= distance_m <= OVERTAKE_MAX_GAP_METERS


def spline_gap_ahead(leader_spline: float, follower_spline: float) -> float:
    """Normalized forward gap from leader to follower along track (0..1)."""
    return (leader_spline - follower_spline) % 1.0


def is_ahead_on_track(car_a_spline: float, car_b_spline: float, margin: float = 0.001) -> bool:
    """True if car A is ahead of car B on the track loop."""
    gap = spline_gap_ahead(car_a_spline, car_b_spline)
    return margin < gap < 0.5


def assign_lead_chase(car1, car2) -> Tuple[str, str]:
    """Return (lead_guid, chase_guid) from spline positions."""
    delta = spline_gap_ahead(car1.spline, car2.spline)
    if delta < 0.5:
        return car1.guid, car2.guid
    return car2.guid, car1.guid
