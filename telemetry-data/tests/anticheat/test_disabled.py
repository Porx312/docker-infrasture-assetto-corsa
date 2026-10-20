"""ANTICHEAT_ENABLED=false → no-op, no state pollution."""

from __future__ import annotations

from anticheat.clock import FakeClock
from anticheat.config import AnticheatConfig
from anticheat.engine import AnticheatEngine
from anticheat.types import SampleDisposition


def test_disabled_engine_is_noop():
    clock = FakeClock()
    eng = AnticheatEngine(
        AnticheatConfig(enabled=False),
        clock=clock,
    )
    r = eng.on_car_update(
        server_key="server-1",
        guid="g1",
        car_id=1,
        pos=(0, 0, 0),
        vel=(10, 0, 0),
        spline=0.1,
        recv_mono=clock.monotonic(),
    )
    assert r.disabled is True
    assert r.disposition == SampleDisposition.OK
    assert eng.store.player_count() == 0
    assert eng.metrics.samples_disabled == 1


def test_disabled_join_leave_noop():
    eng = AnticheatEngine(AnticheatConfig(enabled=False))
    eng.on_join("s", "g", 1)
    eng.on_leave("s", "g")
    assert eng.store.player_count() == 0


def test_maybe_sanction_always_noop_even_if_misconfigured():
    eng = AnticheatEngine(
        AnticheatConfig(enabled=True, mode="enforce", sanctions_enabled=True)
    )
    # No kick API exists; method is explicit no-op
    assert eng.maybe_sanction("anything") is None
