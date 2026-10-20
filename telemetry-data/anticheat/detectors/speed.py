"""Speed range detector (‖v‖ from CAR_UPDATE vel components, m/s)."""

from __future__ import annotations

from typing import List

from anticheat.config import AnticheatConfig
from anticheat.detectors.validity import speed_ms_from_vel
from anticheat.types import Anomaly, CarSample, Severity


def check(sample: CarSample, cfg: AnticheatConfig) -> List[Anomaly]:
    speed_ms = speed_ms_from_vel(sample.vel)
    speed_kmh = speed_ms * 3.6
    if speed_kmh > cfg.max_speed_kmh:
        return [
            Anomaly(
                rule_id="speed_range",
                anomaly_type="speed_ceiling",
                severity=Severity.HIGH,
                confidence=0.7,
                observed={
                    "speed_ms": speed_ms,
                    "speed_kmh": speed_kmh,
                    "max_speed_kmh": cfg.max_speed_kmh,
                },
                reason=f"speed {speed_kmh:.1f} km/h exceeds configured ceiling {cfg.max_speed_kmh:.1f}",
            )
        ]
    return []
