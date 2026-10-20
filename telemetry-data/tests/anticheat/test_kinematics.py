"""Position jumps with valid vs invalid Δt."""

from __future__ import annotations

from dataclasses import replace

from anticheat.engine import AnticheatEngine
from anticheat.sink import CollectingSink
from anticheat.types import SampleDisposition
from helpers import drive


def test_position_jump_with_valid_dt(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0)
    # 200m in 0.05s at 5 m/s is impossible
    r = drive(engine, clock, pos=(200, 0, 0), vel=(5, 0, 0), dt=0.05)
    assert r.disposition == SampleDisposition.OK
    assert any(a.rule_id == "position_jump" for a in r.anomalies)


def test_position_jump_skipped_when_dt_invalid(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0)
    r = drive(engine, clock, pos=(200, 0, 0), vel=(5, 0, 0), dt=3.0)
    assert r.disposition == SampleDisposition.UNUSABLE
    assert not any(a.rule_id == "position_jump" for a in r.anomalies)


def test_normal_motion_no_jump(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(20, 0, 0), dt=0.0)
    # 20 m/s * 0.05s = 1m
    r = drive(engine, clock, pos=(1.0, 0, 0), vel=(20, 0, 0), dt=0.05)
    assert r.disposition == SampleDisposition.OK
    assert not any(a.rule_id == "position_jump" for a in r.anomalies)


def test_speed_ceiling(enabled_config, clock):
    cfg = replace(enabled_config, max_speed_kmh=100.0)
    eng = AnticheatEngine(cfg, clock=clock, sink=CollectingSink())
    # 50 m/s = 180 km/h
    drive(eng, clock, pos=(0, 0, 0), vel=(50, 0, 0), dt=0.0)
    r = drive(eng, clock, pos=(2.5, 0, 0), vel=(50, 0, 0), dt=0.05)
    assert any(a.rule_id == "speed_range" for a in r.anomalies)
