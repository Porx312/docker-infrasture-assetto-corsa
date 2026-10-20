"""Handler hooks: disabled by default; enabled path stays observe-only."""

from __future__ import annotations

import struct
from types import SimpleNamespace

import pytest

from anticheat.engine import reset_engine_for_tests
from anticheat.hooks import hook_car_update, hook_join, hook_leave
from network.ac_packet import ACSP


@pytest.fixture(autouse=True)
def _reset_engine():
    reset_engine_for_tests()
    yield
    reset_engine_for_tests()


def test_hook_car_update_noop_when_disabled(monkeypatch):
    monkeypatch.delenv("ANTICHEAT_ENABLED", raising=False)
    reset_engine_for_tests()
    state = SimpleNamespace(server_folder_id="server-1", port=12000)
    hook_car_update(
        state,
        guid="76561198000000001",
        car_id=1,
        pos_x=0,
        pos_y=0,
        pos_z=0,
        v_x=10,
        v_y=0,
        v_z=0,
        spline=0.2,
    )
    from anticheat import get_engine

    eng = get_engine()
    assert eng.config.enabled is False
    assert eng.store.player_count() == 0


def test_hooks_enabled_join_leave_clears(monkeypatch):
    monkeypatch.setenv("ANTICHEAT_ENABLED", "true")
    reset_engine_for_tests()
    state = SimpleNamespace(server_folder_id="server-9", port=12001)
    hook_join(state, guid="g1", car_id=4)
    from anticheat import get_engine

    eng = get_engine()
    assert eng.store.get("server-9", "g1") is not None
    hook_leave(state, guid="g1")
    assert eng.store.get("server-9", "g1") is None


def test_packet_processor_still_handles_car_update_with_hook(monkeypatch):
    """Existing dispatch path must not break with anticheat import wired."""
    monkeypatch.delenv("ANTICHEAT_ENABLED", raising=False)
    reset_engine_for_tests()

    from core.handlers import process_packet
    from core.session_manager import DriverInfo

    class FakeBattle:
        def set_server_mode(self, *_a, **_k):
            pass

        def update(self, *_a, **_k):
            pass

    class FakeEngine:
        def check_idle(self, *_a, **_k):
            pass

    driver = DriverInfo("Test", "76561198000000001", "car")
    driver.car_id = 0
    state = SimpleNamespace(
        active_drivers={0: driver},
        last_car_update_ms=0,
        last_server_addr=("127.0.0.1", 9600),
        event_engine=FakeEngine(),
        battle_manager=FakeBattle(),
        port=12000,
        server_folder_id="server-1",
        server_mode="practice",
        _mode_lookup_logged=True,
    )
    packet = struct.pack(
        "<B B f f f f f f B H f",
        getattr(ACSP, "CAR_UPDATE", 53),
        0,
        1.0,
        2.0,
        3.0,
        10.0,
        0.0,
        0.0,
        3,
        5000,
        0.5,
    )
    process_packet(packet, state, ("127.0.0.1", 1))
    assert state.last_car_update_ms > 0
