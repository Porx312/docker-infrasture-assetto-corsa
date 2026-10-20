"""Realistic driving + packet loss should not produce false kinematic evidence."""

from __future__ import annotations

import math

from anticheat.types import SampleDisposition
from helpers import drive


def test_realistic_cruise_no_anomalies(engine, clock):
    speed = 40.0  # m/s ~144 km/h
    x = 0.0
    drive(engine, clock, pos=(x, 0, 0), vel=(speed, 0, 0), spline=0.0, dt=0.0)
    for i in range(40):
        dt = 0.05
        x += speed * dt
        spline = (i * 0.01) % 1.0
        r = drive(
            engine, clock,
            pos=(x, 0.0, math.sin(i * 0.1) * 0.01),
            vel=(speed, 0.0, 0.0),
            spline=spline,
            dt=dt,
        )
        assert r.disposition == SampleDisposition.OK
        assert r.anomalies == []
        assert r.evidence == []


def test_packet_loss_gap_then_resume_no_jump_fp(engine, clock):
    speed = 30.0
    x = 0.0
    drive(engine, clock, pos=(x, 0, 0), vel=(speed, 0, 0), dt=0.0)
    for _ in range(5):
        x += speed * 0.05
        drive(engine, clock, pos=(x, 0, 0), vel=(speed, 0, 0), dt=0.05)
    # Lost packets for 1.2s — car continues physically
    gap = 1.2
    x += speed * gap
    r_gap = drive(engine, clock, pos=(x, 0, 0), vel=(speed, 0, 0), dt=gap)
    assert r_gap.disposition == SampleDisposition.UNUSABLE
    assert not any(a.rule_id == "position_jump" for a in r_gap.anomalies)
    # Resume
    for _ in range(5):
        x += speed * 0.05
        r = drive(engine, clock, pos=(x, 0, 0), vel=(speed, 0, 0), dt=0.05)
        assert r.disposition == SampleDisposition.OK
        assert not any(a.rule_id == "position_jump" for a in r.anomalies)


def test_gentle_braking_no_accel_spike(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(30, 0, 0), dt=0.0)
    x = 0.0
    v = 30.0
    for _ in range(20):
        v = max(0.0, v - 1.0)  # ~20 m/s² decel — under default 80
        x += v * 0.05
        r = drive(engine, clock, pos=(x, 0, 0), vel=(v, 0, 0), dt=0.05)
        assert not any(a.rule_id == "accel_spike" for a in r.anomalies)
