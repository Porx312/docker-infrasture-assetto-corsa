"""Pure detectors — no I/O, no shared mutable state."""

from __future__ import annotations

from typing import List, Optional

from anticheat.config import AnticheatConfig
from anticheat.detectors import acceleration, consistency, kinematics, lap, speed, validity
from anticheat.state import PlayerState
from anticheat.types import Anomaly, CarSample, LapSample


def run_car_detectors(
    sample: CarSample,
    prev: Optional[PlayerState],
    dt: float,
    cfg: AnticheatConfig,
    *,
    kinematics_ok: bool,
) -> List[Anomaly]:
    """Run field-level detectors. Kinematic ones only if kinematics_ok."""
    anomalies: List[Anomaly] = []
    # speed / consistency do not require a previous sample
    anomalies.extend(speed.check(sample, cfg))
    anomalies.extend(consistency.check(sample, cfg))
    if kinematics_ok and prev is not None and prev.has_baseline:
        anomalies.extend(kinematics.check(sample, prev, dt, cfg))
        anomalies.extend(acceleration.check(sample, prev, dt, cfg))
    return anomalies


def run_lap_detectors(sample: LapSample, cfg: AnticheatConfig) -> List[Anomaly]:
    return lap.check(sample, cfg)


__all__ = [
    "run_car_detectors",
    "run_lap_detectors",
    "validity",
    "speed",
    "kinematics",
    "acceleration",
    "consistency",
    "lap",
]
