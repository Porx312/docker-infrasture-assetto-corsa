"""Acceleration spike detector + consecutive samples."""

from __future__ import annotations

from dataclasses import replace

from anticheat.engine import AnticheatEngine
from anticheat.sink import CollectingSink
from helpers import drive


def test_accel_spike_on_valid_interval(enabled_config, clock):
    cfg = replace(enabled_config, max_accel_ms2=20.0)
    eng = AnticheatEngine(cfg, clock=clock, sink=CollectingSink())
    drive(eng, clock, pos=(0, 0, 0), vel=(0, 0, 0), dt=0.0)
    # 0 → 40 m/s in 0.05s => 800 m/s²
    r = drive(eng, clock, pos=(1, 0, 0), vel=(40, 0, 0), dt=0.05)
    assert any(a.rule_id == "accel_spike" for a in r.anomalies)


def test_consecutive_normal_accel_no_spike(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(10, 0, 0), dt=0.0)
    r1 = drive(engine, clock, pos=(0.5, 0, 0), vel=(11, 0, 0), dt=0.05)
    r2 = drive(engine, clock, pos=(1.05, 0, 0), vel=(12, 0, 0), dt=0.05)
    assert not any(a.rule_id == "accel_spike" for a in r1.anomalies)
    assert not any(a.rule_id == "accel_spike" for a in r2.anomalies)
