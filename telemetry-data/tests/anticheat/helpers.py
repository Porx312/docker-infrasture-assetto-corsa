"""Shared helpers for anticheat tests."""

from __future__ import annotations

from anticheat.clock import FakeClock
from anticheat.engine import AnticheatEngine


def drive(
    eng: AnticheatEngine,
    clock: FakeClock,
    *,
    server_key: str = "server-1",
    guid: str = "76561198000000001",
    car_id: int = 1,
    pos,
    vel,
    spline: float = 0.5,
    dt: float = 0.05,
):
    clock.advance(dt)
    return eng.on_car_update(
        server_key=server_key,
        guid=guid,
        car_id=car_id,
        pos=pos,
        vel=vel,
        spline=spline,
        recv_mono=clock.monotonic(),
    )
