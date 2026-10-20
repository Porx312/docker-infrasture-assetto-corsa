"""NaN / Inf / invalid fields must not contaminate state or scoring."""

from __future__ import annotations

import math

from anticheat.types import SampleDisposition
from helpers import drive


def test_nan_pos_unusable_no_baseline(engine, clock):
    r = engine.on_car_update(
        server_key="server-1",
        guid="g1",
        car_id=1,
        pos=(math.nan, 0.0, 0.0),
        vel=(1.0, 0.0, 0.0),
        spline=0.1,
        recv_mono=clock.monotonic(),
    )
    assert r.disposition == SampleDisposition.UNUSABLE
    assert r.unusable_reason == "non_finite_pos"
    st = engine.store.get("server-1", "g1")
    assert st is None or not st.has_baseline
    assert r.risk_score == 0.0


def test_inf_vel_unusable(engine, clock):
    r = engine.on_car_update(
        server_key="server-1",
        guid="g1",
        car_id=1,
        pos=(0.0, 0.0, 0.0),
        vel=(math.inf, 0.0, 0.0),
        spline=0.1,
        recv_mono=clock.monotonic(),
    )
    assert r.disposition == SampleDisposition.UNUSABLE
    assert r.unusable_reason == "non_finite_vel"


def test_nan_does_not_break_following_good_samples(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(10, 0, 0), dt=0.0)
    clock.advance(0.05)
    engine.on_car_update(
        server_key="server-1",
        guid="76561198000000001",
        car_id=1,
        pos=(math.nan, 0, 0),
        vel=(10, 0, 0),
        spline=0.5,
        recv_mono=clock.monotonic(),
    )
    # Good sample after NaN still works
    r = drive(engine, clock, pos=(0.5, 0, 0), vel=(10, 0, 0), dt=0.05)
    assert r.disposition == SampleDisposition.OK
    assert r.risk_score == 0.0


def test_invalid_car_id_packet(engine, clock):
    r = engine.on_car_update(
        server_key="server-1",
        guid="g1",
        car_id=-1,
        pos=(0, 0, 0),
        vel=(0, 0, 0),
        spline=0.0,
        recv_mono=clock.monotonic(),
    )
    assert r.disposition == SampleDisposition.INVALID_PACKET


def test_spline_out_of_range_anomaly(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(5, 0, 0), spline=0.5, dt=0.0)
    r = drive(engine, clock, pos=(0.25, 0, 0), vel=(5, 0, 0), spline=2.5, dt=0.05)
    assert any(a.rule_id == "telemetry_consistency" for a in r.anomalies)
