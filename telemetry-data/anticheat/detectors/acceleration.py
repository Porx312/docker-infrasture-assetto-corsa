"""Acceleration spike from Δ‖v‖/Δt (lax band; collisions can spike)."""

from __future__ import annotations

from typing import List

from anticheat.config import AnticheatConfig
from anticheat.detectors.validity import speed_ms_from_vel
from anticheat.state import PlayerState
from anticheat.types import Anomaly, CarSample, Severity


def check(
    sample: CarSample,
    prev: PlayerState,
    dt: float,
    cfg: AnticheatConfig,
) -> List[Anomaly]:
    if prev.last_speed_ms is None or dt <= 0:
        return []
    speed_ms = speed_ms_from_vel(sample.vel)
    accel = abs(speed_ms - prev.last_speed_ms) / dt
    if accel > cfg.max_accel_ms2:
        return [
            Anomaly(
                rule_id="accel_spike",
                anomaly_type="acceleration_spike",
                severity=Severity.MEDIUM,
                confidence=0.4,
                observed={
                    "accel_ms2": accel,
                    "max_accel_ms2": cfg.max_accel_ms2,
                    "speed_ms": speed_ms,
                    "prev_speed_ms": prev.last_speed_ms,
                    "dt_sec": dt,
                },
                reason=(
                    f"|Δv|/Δt={accel:.1f} m/s² exceeds configured {cfg.max_accel_ms2:.1f} "
                    "(may be collision/lag; not conclusive)"
                ),
            )
        ]
    return []
