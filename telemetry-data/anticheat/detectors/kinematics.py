"""Position jump vs ‖v‖·Δt (requires valid monotonic Δt; no gap handling here)."""

from __future__ import annotations

import math
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
    if prev.last_pos is None or dt <= 0:
        return []
    dx = sample.pos[0] - prev.last_pos[0]
    dy = sample.pos[1] - prev.last_pos[1]
    dz = sample.pos[2] - prev.last_pos[2]
    distance = math.sqrt(dx * dx + dy * dy + dz * dz)
    speed_ms = speed_ms_from_vel(sample.vel)
    # Use max of current/previous speed for expected travel envelope
    prev_speed = prev.last_speed_ms if prev.last_speed_ms is not None else speed_ms
    envelope_speed = max(speed_ms, prev_speed)
    allowed = (
        envelope_speed * dt * cfg.position_jump_speed_factor + cfg.position_jump_margin_m
    )
    if distance > allowed:
        return [
            Anomaly(
                rule_id="position_jump",
                anomaly_type="position_discontinuity",
                severity=Severity.HIGH,
                confidence=0.55,
                observed={
                    "distance_m": distance,
                    "allowed_m": allowed,
                    "dt_sec": dt,
                    "speed_ms": speed_ms,
                    "prev_speed_ms": prev_speed,
                },
                reason=(
                    f"position jump {distance:.1f}m in {dt:.3f}s exceeds "
                    f"envelope {allowed:.1f}m (ACSP telemetry inconsistency)"
                ),
            )
        ]
    return []
