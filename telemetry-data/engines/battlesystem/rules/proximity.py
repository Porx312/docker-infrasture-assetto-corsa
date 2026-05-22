"""Distance and track-position helpers for touge battles."""

from __future__ import annotations

import math
from typing import Tuple

from engines.battlesystem.config import (
    BATTLE_ARM_MAX_GAP_METERS,
    OVERTAKE_MAX_GAP_FALLBACK_METERS,
    OVERTAKE_MAX_GAP_METERS,
    OVERTAKE_MIN_GAP_METERS,
    POSITION_AHEAD_MIN_METERS,
    SPLINE_INVALID_EPS,
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


def spline_position_unusable(car) -> bool:
    """True when AC NormalizedPosition is missing or not meaningful for scoring."""
    return car.spline <= SPLINE_INVALID_EPS or not getattr(car, "spline_reliable", True)


def pair_needs_position_fallback(car1, car2, *, manager=None) -> bool:
    if manager is not None and getattr(manager, "_position_fallback", False):
        return True
    if spline_position_unusable(car1) or spline_position_unusable(car2):
        return True
    return pair_uses_position_fallback(car1, car2)


def is_overtake_scoring_gap_for_pair(
    distance_m: float, car1, car2, *, manager=None
) -> bool:
    max_gap = (
        max(OVERTAKE_MAX_GAP_FALLBACK_METERS, BATTLE_ARM_MAX_GAP_METERS)
        if pair_needs_position_fallback(car1, car2, manager=manager)
        else OVERTAKE_MAX_GAP_METERS
    )
    return OVERTAKE_MIN_GAP_METERS <= distance_m <= max_gap


def spline_gap_ahead(leader_spline: float, follower_spline: float) -> float:
    """Normalized forward gap from leader to follower along track (0..1)."""
    return (leader_spline - follower_spline) % 1.0


def is_ahead_on_track(car_a_spline: float, car_b_spline: float, margin: float = 0.001) -> bool:
    """True if car A is ahead of car B on the track loop."""
    gap = spline_gap_ahead(car_a_spline, car_b_spline)
    return margin < gap < 0.5


def pair_uses_position_fallback(car1, car2) -> bool:
    """True when either driver lacks a usable AC NormalizedPosition spline."""
    return not getattr(car1, "spline_reliable", True) or not getattr(
        car2, "spline_reliable", True
    )


def _normalize_forward(vel: Tuple[float, float, float], speed_kmh: float) -> Tuple[float, float, float]:
    vx, vy, vz = vel
    mag = math.sqrt(vx * vx + vy * vy + vz * vz)
    if mag >= 1.0:
        return (vx / mag, vy / mag, vz / mag)
    return (0.0, 0.0, 0.0)


def _forward_from_motion(car) -> Tuple[float, float, float]:
    """Velocity vector, or recent position delta when AC velocity is near zero."""
    fx, fy, fz = _normalize_forward(car.vel, car.speed)
    if fx or fy or fz:
        return (fx, fy, fz)
    if car.last_update_time > 0:
        dx = car.pos[0] - car._prev_pos[0]
        dy = car.pos[1] - car._prev_pos[1]
        dz = car.pos[2] - car._prev_pos[2]
        mag = math.sqrt(dx * dx + dy * dy + dz * dz)
        if mag >= 0.5:
            return (dx / mag, dy / mag, dz / mag)
    return (0.0, 0.0, 1.0)


def is_ahead_by_position(
    car_a,
    car_b,
    min_meters: float = POSITION_AHEAD_MIN_METERS,
) -> bool:
    """
    True if car A is ahead of car B using world position projected on track-forward.
    Used when track spline is missing (touge maps without fast_lane.ai).
    """
    dx = car_a.pos[0] - car_b.pos[0]
    dy = car_a.pos[1] - car_b.pos[1]
    dz = car_a.pos[2] - car_b.pos[2]
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    if dist < min_meters:
        return False

    ref = car_b if car_b.speed >= car_a.speed else car_a
    fx, fy, fz = _forward_from_motion(ref)
    longitudinal = dx * fx + dy * fy + dz * fz
    return longitudinal >= min_meters


def is_ahead_with_fallback(
    car_a,
    car_b,
    margin: float = 0.001,
    position_min_m: float = POSITION_AHEAD_MIN_METERS,
    *,
    manager=None,
) -> bool:
    if pair_needs_position_fallback(car_a, car_b, manager=manager):
        return is_ahead_by_position(car_a, car_b, position_min_m)
    return is_ahead_on_track(car_a.spline, car_b.spline, margin)


def assign_lead_chase(car1, car2) -> Tuple[str, str]:
    """Return (lead_guid, chase_guid) from spline positions."""
    delta = spline_gap_ahead(car1.spline, car2.spline)
    if delta < 0.5:
        return car1.guid, car2.guid
    return car2.guid, car1.guid


def assign_lead_chase_with_fallback(car1, car2, *, manager=None) -> Tuple[str, str]:
    if not pair_needs_position_fallback(car1, car2, manager=manager):
        return assign_lead_chase(car1, car2)
    if is_ahead_by_position(car1, car2):
        return car1.guid, car2.guid
    if is_ahead_by_position(car2, car1):
        return car2.guid, car1.guid
    return assign_lead_chase(car1, car2)


def pair_uses_position_fallback_from_manager(manager) -> bool:
    if not manager.battle:
        return False
    car1 = manager.cars.get(manager.battle.car1_guid)
    car2 = manager.cars.get(manager.battle.car2_guid)
    if not car1 or not car2:
        return False
    return pair_needs_position_fallback(car1, car2, manager=manager)
