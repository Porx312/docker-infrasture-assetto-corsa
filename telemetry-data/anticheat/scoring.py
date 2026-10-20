"""Risk scoring with decay and per-sample deduplication."""

from __future__ import annotations

from typing import List, Optional, Tuple

from anticheat.config import AnticheatConfig
from anticheat.state import PlayerState
from anticheat.types import Anomaly, EvidenceEvent, Severity


_SEVERITY_ATTR = {
    Severity.LOW: "score_weight_low",
    Severity.MEDIUM: "score_weight_medium",
    Severity.HIGH: "score_weight_high",
}


def decay_score(state: PlayerState, now_mono: float, cfg: AnticheatConfig) -> float:
    if state.last_recv_mono is None:
        return state.risk_score
    dt = now_mono - state.last_recv_mono
    if dt <= 0:
        return state.risk_score
    decayed = max(0.0, state.risk_score - cfg.score_decay_per_sec * dt)
    state.risk_score = decayed
    return decayed


def apply_anomalies(
    state: PlayerState,
    sample_id: int,
    anomalies: List[Anomaly],
    cfg: AnticheatConfig,
    now_mono: float,
    car_id: int,
) -> Tuple[float, List[EvidenceEvent], bool]:
    """Apply anomalies to score once per sample_id.

    Returns (risk_score, evidence_events, deduped).
    Multiple detectors on the same sample contribute at most the max weight once.
    """
    decay_score(state, now_mono, cfg)
    if not anomalies:
        return state.risk_score, [], False

    if state.last_scored_sample_id == sample_id:
        return state.risk_score, [], True

    # One contribution per sample: take the highest severity weight among anomalies.
    best: Optional[Anomaly] = None
    best_weight = 0.0
    for anomaly in anomalies:
        weight = float(getattr(cfg, _SEVERITY_ATTR[anomaly.severity]))
        if best is None or weight > best_weight:
            best = anomaly
            best_weight = weight
        elif weight == best_weight and best is not None:
            # Prefer higher confidence on ties
            if anomaly.confidence > best.confidence:
                best = anomaly

    assert best is not None
    state.risk_score += best_weight
    state.last_scored_sample_id = sample_id
    state.recent_sample_ids.append(sample_id)

    evidence: List[EvidenceEvent] = []
    if state.risk_score >= cfg.evidence_score_threshold:
        # Emit one evidence event per anomaly at threshold crossing / while elevated,
        # but still tied to this sample (review bundle). Prefer primary anomaly.
        evidence.append(
            EvidenceEvent(
                steam_id=state.guid,
                car_id=car_id,
                server_key=state.server_key,
                ts_mono=now_mono,
                sample_id=sample_id,
                anomaly_type=best.anomaly_type,
                rule_id=best.rule_id,
                observed={
                    **best.observed,
                    "all_rule_ids": [a.rule_id for a in anomalies],
                    "anomaly_count": len(anomalies),
                },
                severity=best.severity,
                confidence=best.confidence,
                reason=best.reason,
                risk_score=state.risk_score,
            )
        )
    return state.risk_score, evidence, False
