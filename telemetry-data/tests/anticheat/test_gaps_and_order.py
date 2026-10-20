"""Gaps and out-of-order samples → unusable, no kinematic evidence."""

from __future__ import annotations

from anticheat.types import SampleDisposition
from helpers import drive


def test_large_gap_no_position_jump_evidence(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(20, 0, 0), dt=0.0)
    # Huge gap + large displacement would look like a jump if kinematics ran
    r = drive(engine, clock, pos=(500, 0, 0), vel=(20, 0, 0), dt=2.0)
    assert r.disposition == SampleDisposition.UNUSABLE
    assert r.unusable_reason == "gap_too_large"
    assert not any(a.rule_id == "position_jump" for a in r.anomalies)
    assert r.evidence == []


def test_out_of_order_mono_unusable(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(10, 0, 0), dt=0.0)
    clock.advance(0.05)
    t1 = clock.monotonic()
    engine.on_car_update(
        server_key="server-1",
        guid="76561198000000001",
        car_id=1,
        pos=(0.5, 0, 0),
        vel=(10, 0, 0),
        spline=0.5,
        recv_mono=t1,
    )
    # Older timestamp
    r = engine.on_car_update(
        server_key="server-1",
        guid="76561198000000001",
        car_id=1,
        pos=(100, 0, 0),
        vel=(10, 0, 0),
        spline=0.5,
        recv_mono=t1 - 0.01,
    )
    assert r.disposition == SampleDisposition.UNUSABLE
    assert r.unusable_reason == "out_of_order_or_non_positive_dt"
    assert not any(a.rule_id == "position_jump" for a in r.anomalies)


def test_after_gap_baseline_resets_cleanly(engine, clock):
    drive(engine, clock, pos=(0, 0, 0), vel=(10, 0, 0), dt=0.0)
    drive(engine, clock, pos=(500, 0, 0), vel=(10, 0, 0), dt=2.0)  # gap
    # Next interval normal cruise
    r = drive(engine, clock, pos=(500.5, 0, 0), vel=(10, 0, 0), dt=0.05)
    assert r.disposition == SampleDisposition.OK
    assert r.anomalies == []
