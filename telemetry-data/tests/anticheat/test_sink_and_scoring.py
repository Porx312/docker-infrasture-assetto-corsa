"""Sink saturation, sink errors, scoring dedupe, evidence threshold."""

from __future__ import annotations

from dataclasses import replace

from anticheat.config import AnticheatConfig
from anticheat.engine import AnticheatEngine
from anticheat.scoring import apply_anomalies
from anticheat.sink import CollectingSink, FailingSink
from anticheat.state import PlayerState
from anticheat.types import Anomaly, Severity
from helpers import drive


def test_multiple_detectors_same_sample_score_once(enabled_config, clock):
    # Low ceilings so speed + jump both fire
    cfg = replace(
        enabled_config,
        max_speed_kmh=30.0,
        max_accel_ms2=5.0,
        evidence_score_threshold=1000.0,
        score_weight_high=8.0,
        score_weight_medium=3.0,
    )
    eng = AnticheatEngine(cfg, clock=clock, sink=CollectingSink())
    drive(eng, clock, pos=(0, 0, 0), vel=(0, 0, 0), dt=0.0)
    r = drive(eng, clock, pos=(100, 0, 0), vel=(50, 0, 0), dt=0.05)
    assert len(r.anomalies) >= 2
    # Only one high-weight contribution (max severity), not sum of all
    assert r.risk_score == cfg.score_weight_high


def test_dedupe_same_sample_id(enabled_config):
    state = PlayerState(server_key="s", guid="g")
    anomalies = [
        Anomaly("speed_range", "speed_ceiling", Severity.HIGH, 0.7, {}, "a"),
        Anomaly("position_jump", "jump", Severity.HIGH, 0.5, {}, "b"),
    ]
    score1, _, dedupe1 = apply_anomalies(state, 42, anomalies, enabled_config, 1.0, 1)
    score2, _, dedupe2 = apply_anomalies(state, 42, anomalies, enabled_config, 1.0, 1)
    assert dedupe1 is False
    assert dedupe2 is True
    assert score2 == score1


def test_sink_saturation_drops(enabled_config, clock):
    cfg = replace(
        enabled_config,
        max_speed_kmh=10.0,
        evidence_score_threshold=1.0,
        score_weight_high=8.0,
        sink_queue_size=2,
        score_decay_per_sec=0.0,
    )
    sink = CollectingSink(maxsize=2)
    eng = AnticheatEngine(cfg, clock=clock, sink=sink)
    drive(eng, clock, pos=(0, 0, 0), vel=(50, 0, 0), dt=0.0)
    for i in range(6):
        drive(eng, clock, pos=(i * 3.0, 0, 0), vel=(50, 0, 0), dt=0.05)
    assert eng.metrics.sink_dropped > 0
    assert sink.dropped > 0


def test_failing_sink_drain_counts_errors(enabled_config, clock):
    cfg = replace(
        enabled_config,
        max_speed_kmh=10.0,
        evidence_score_threshold=1.0,
        score_decay_per_sec=0.0,
    )
    sink = FailingSink(maxsize=16)
    eng = AnticheatEngine(cfg, clock=clock, sink=sink)
    drive(eng, clock, pos=(0, 0, 0), vel=(40, 0, 0), dt=0.0)
    drive(eng, clock, pos=(2, 0, 0), vel=(40, 0, 0), dt=0.05)
    # Evidence enqueued; drain triggers consumer errors
    sink.drain_sync()
    assert sink.errors >= 1


def test_single_anomaly_not_conclusive_evidence(enabled_config, clock):
    """One anomaly raises score but stays below evidence threshold by default."""
    cfg = replace(enabled_config, evidence_score_threshold=12.0, score_weight_high=8.0)
    eng = AnticheatEngine(cfg, clock=clock, sink=CollectingSink())
    drive(eng, clock, pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0)
    r = drive(eng, clock, pos=(200, 0, 0), vel=(5, 0, 0), dt=0.05)
    assert r.anomalies
    assert r.risk_score == 8.0
    assert r.evidence == []
