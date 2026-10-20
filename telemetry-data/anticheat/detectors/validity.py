"""Field validity: NaN/Inf and basic type sanity (no I/O)."""

from __future__ import annotations

import math
from typing import Any, Optional, Tuple


def is_finite_number(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def vec3_finite(vec: Any) -> bool:
    if not isinstance(vec, (tuple, list)) or len(vec) != 3:
        return False
    return all(is_finite_number(c) for c in vec)


def validate_car_fields(
    pos: Any,
    vel: Any,
    spline: Any,
    car_id: Any,
    server_key: Any,
    guid: Any,
) -> Optional[str]:
    """Return unusable/invalid reason, or None if fields are usable."""
    if not isinstance(server_key, str) or not server_key:
        return "invalid_server_key"
    if not isinstance(guid, str) or not guid:
        return "invalid_guid"
    if not isinstance(car_id, int) or isinstance(car_id, bool) or car_id < 0 or car_id > 255:
        return "invalid_car_id"
    if not vec3_finite(pos):
        return "non_finite_pos"
    if not vec3_finite(vel):
        return "non_finite_vel"
    if not is_finite_number(spline):
        return "non_finite_spline"
    return None


def speed_ms_from_vel(vel: Tuple[float, float, float]) -> float:
    return math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2])
