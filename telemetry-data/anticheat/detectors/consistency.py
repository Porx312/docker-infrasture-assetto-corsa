"""Telemetry consistency: spline range (NormalizedPosition ~[0,1])."""

from __future__ import annotations

from typing import List

from anticheat.config import AnticheatConfig
from anticheat.types import Anomaly, CarSample, Severity


def check(sample: CarSample, cfg: AnticheatConfig) -> List[Anomaly]:
    eps = cfg.spline_out_of_range_eps
    if sample.spline < -eps or sample.spline > 1.0 + eps:
        return [
            Anomaly(
                rule_id="telemetry_consistency",
                anomaly_type="spline_out_of_range",
                severity=Severity.LOW,
                confidence=0.5,
                observed={
                    "spline": sample.spline,
                    "eps": eps,
                },
                reason=f"spline {sample.spline:.4f} outside [{-eps:.3f}, {1+eps:.3f}]",
            )
        ]
    return []
