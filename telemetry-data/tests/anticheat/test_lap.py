"""Lap integrity detector (time ms + cuts only)."""

from __future__ import annotations

from anticheat.types import SampleDisposition


def test_lap_cuts_anomaly(engine, clock):
    r = engine.on_lap(
        server_key="server-1",
        guid="g1",
        car_id=1,
        lap_time_ms=95000,
        cuts=2,
        recv_mono=clock.monotonic(),
    )
    assert r.disposition == SampleDisposition.OK
    assert any(a.anomaly_type == "track_cuts" for a in r.anomalies)


def test_lap_too_fast(engine, clock):
    r = engine.on_lap(
        server_key="server-1",
        guid="g1",
        car_id=1,
        lap_time_ms=5000,
        cuts=0,
        recv_mono=clock.monotonic(),
    )
    assert any(a.anomaly_type == "lap_time_too_fast" for a in r.anomalies)


def test_normal_lap_no_anomaly(engine, clock):
    r = engine.on_lap(
        server_key="server-1",
        guid="g1",
        car_id=1,
        lap_time_ms=120000,
        cuts=0,
        recv_mono=clock.monotonic(),
    )
    assert r.anomalies == []
