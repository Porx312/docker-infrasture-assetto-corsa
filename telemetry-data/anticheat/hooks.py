"""Thin observe-only hooks for ACSP handlers (no kick/ban, no blocking I/O)."""

from __future__ import annotations

from typing import Optional

from anticheat import get_engine, server_key_from_state
from anticheat.engine import AnticheatEngine


def _engine() -> AnticheatEngine:
    return get_engine()


def hook_car_update(
    server_state,
    *,
    guid: str,
    car_id: int,
    pos_x: float,
    pos_y: float,
    pos_z: float,
    v_x: float,
    v_y: float,
    v_z: float,
    spline: float,
) -> None:
    eng = _engine()
    if not eng.config.enabled:
        return
    if not guid or guid.startswith("unknown_"):
        return
    eng.on_car_update(
        server_key=server_key_from_state(server_state),
        guid=guid,
        car_id=int(car_id),
        pos=(float(pos_x or 0.0), float(pos_y or 0.0), float(pos_z or 0.0)),
        vel=(float(v_x or 0.0), float(v_y or 0.0), float(v_z or 0.0)),
        spline=float(spline) if spline is not None else 0.0,
    )


def hook_lap_completed(
    server_state,
    *,
    guid: str,
    car_id: int,
    lap_time_ms: int,
    cuts: int,
) -> None:
    eng = _engine()
    if not eng.config.enabled:
        return
    if not guid or guid.startswith("unknown_"):
        return
    eng.on_lap(
        server_key=server_key_from_state(server_state),
        guid=guid,
        car_id=int(car_id),
        lap_time_ms=int(lap_time_ms),
        cuts=int(cuts),
    )


def hook_join(server_state, *, guid: str, car_id: int) -> None:
    eng = _engine()
    if not eng.config.enabled:
        return
    if not guid or guid.startswith("unknown_"):
        return
    eng.on_join(server_key_from_state(server_state), guid, int(car_id))


def hook_leave(server_state, *, guid: Optional[str]) -> None:
    eng = _engine()
    if not eng.config.enabled:
        return
    if not guid or guid.startswith("unknown_"):
        return
    eng.on_leave(server_key_from_state(server_state), guid)
