"""Shared types for ACSP telemetry anticheat (observe-only module)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class SampleDisposition(str, Enum):
    """Primary per-sample outcome (taxonomy; do not conflate with scoring)."""

    INVALID_PACKET = "invalid_packet"
    UNUSABLE = "unusable"
    OK = "ok"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


Vec3 = Tuple[float, float, float]


@dataclass(frozen=True)
class CarSample:
    """One CAR_UPDATE observation as delivered to the plugin.

    Units match current telemetry-data handlers:
    - pos: world floats treated as meters
    - vel: m/s components (magnitude also m/s)
    - spline: AC NormalizedPosition, typically ~[0, 1]

    ``recv_mono`` is reception time on a monotonic clock — not the exact
    physics instant on the dedicated server.
    """

    server_key: str
    guid: str
    car_id: int
    pos: Vec3
    vel: Vec3
    spline: float
    recv_mono: float
    sample_id: int = 0


@dataclass(frozen=True)
class LapSample:
    """LAP_COMPLETED fields actually parsed today (no sector times)."""

    server_key: str
    guid: str
    car_id: int
    lap_time_ms: int
    cuts: int
    recv_mono: float
    sample_id: int = 0


@dataclass(frozen=True)
class Anomaly:
    rule_id: str
    anomaly_type: str
    severity: Severity
    confidence: float
    observed: Dict[str, Any]
    reason: str


@dataclass(frozen=True)
class EvidenceEvent:
    """Persistent signal for human review — not conclusive cheat proof alone."""

    steam_id: str
    car_id: int
    server_key: str
    ts_mono: float
    sample_id: int
    anomaly_type: str
    rule_id: str
    observed: Dict[str, Any]
    severity: Severity
    confidence: float
    reason: str
    risk_score: float


@dataclass
class TickResult:
    disposition: SampleDisposition
    sample_id: Optional[int] = None
    unusable_reason: Optional[str] = None
    anomalies: List[Anomaly] = field(default_factory=list)
    evidence: List[EvidenceEvent] = field(default_factory=list)
    risk_score: float = 0.0
    disabled: bool = False
    config_warnings: List[str] = field(default_factory=list)
