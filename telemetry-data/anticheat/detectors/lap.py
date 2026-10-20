"""Lap integrity using only parsed LAP_COMPLETED fields (time ms + cuts).

Does not claim sector-time or teleport detection beyond cuts signal already
used elsewhere in telemetry-data.
"""

from __future__ import annotations

from typing import List

from anticheat.config import AnticheatConfig
from anticheat.types import Anomaly, LapSample, Severity


def check(sample: LapSample, cfg: AnticheatConfig) -> List[Anomaly]:
    anomalies: List[Anomaly] = []
    if sample.lap_time_ms <= 0 or sample.lap_time_ms > cfg.max_valid_lap_ms:
        anomalies.append(
            Anomaly(
                rule_id="lap_integrity",
                anomaly_type="lap_time_out_of_range",
                severity=Severity.MEDIUM,
                confidence=0.6,
                observed={
                    "lap_time_ms": sample.lap_time_ms,
                    "max_valid_lap_ms": cfg.max_valid_lap_ms,
                },
                reason=f"lap_time_ms={sample.lap_time_ms} outside (0, {cfg.max_valid_lap_ms}]",
            )
        )
    elif sample.lap_time_ms < cfg.min_valid_lap_ms:
        anomalies.append(
            Anomaly(
                rule_id="lap_integrity",
                anomaly_type="lap_time_too_fast",
                severity=Severity.HIGH,
                confidence=0.55,
                observed={
                    "lap_time_ms": sample.lap_time_ms,
                    "min_valid_lap_ms": cfg.min_valid_lap_ms,
                },
                reason=(
                    f"lap_time_ms={sample.lap_time_ms} < min_valid_lap_ms="
                    f"{cfg.min_valid_lap_ms}"
                ),
            )
        )
    if sample.cuts >= cfg.cuts_anomaly_threshold:
        anomalies.append(
            Anomaly(
                rule_id="lap_integrity",
                anomaly_type="track_cuts",
                severity=Severity.MEDIUM,
                confidence=0.7,
                observed={"cuts": sample.cuts},
                reason=f"ACSP reported cuts={sample.cuts}",
            )
        )
    return anomalies
