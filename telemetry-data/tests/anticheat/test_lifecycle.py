"""Disconnect / reconnect / player isolation / multi-server car_id."""

from __future__ import annotations

from dataclasses import replace

from anticheat.engine import AnticheatEngine
from anticheat.sink import CollectingSink
from helpers import drive


def test_leave_clears_state_and_score(engine, clock, enabled_config):
    # Accumulate score via repeated speed ceiling
    cfg = replace(enabled_config, max_speed_kmh=50.0, evidence_score_threshold=100.0)
    eng = AnticheatEngine(cfg, clock=clock, sink=CollectingSink())
    guid = "76561198000000001"
    drive(eng, clock, guid=guid, pos=(0, 0, 0), vel=(40, 0, 0), dt=0.0)  # 144 km/h
    r = drive(eng, clock, guid=guid, pos=(2, 0, 0), vel=(40, 0, 0), dt=0.05)
    assert r.risk_score > 0
    eng.on_leave("server-1", guid)
    assert eng.store.get("server-1", guid) is None
    # Reconnect: clean session
    eng.on_join("server-1", guid, 1)
    r2 = drive(eng, clock, guid=guid, pos=(0, 0, 0), vel=(5, 0, 0), dt=0.05)
    assert r2.risk_score == 0.0


def test_players_isolated(engine, clock):
    drive(engine, clock, guid="g1", car_id=1, pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0)
    drive(engine, clock, guid="g2", car_id=2, pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0)
    # Jump only for g1
    r1 = drive(engine, clock, guid="g1", car_id=1, pos=(300, 0, 0), vel=(5, 0, 0), dt=0.05)
    r2 = drive(engine, clock, guid="g2", car_id=2, pos=(0.25, 0, 0), vel=(5, 0, 0), dt=0.05)
    assert any(a.rule_id == "position_jump" for a in r1.anomalies)
    assert r2.anomalies == []
    assert engine.store.get("server-1", "g2") is not None


def test_same_car_id_different_servers_isolated(engine, clock):
    drive(
        engine, clock, server_key="server-a", guid="g1", car_id=3,
        pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0,
    )
    drive(
        engine, clock, server_key="server-b", guid="g1", car_id=3,
        pos=(0, 0, 0), vel=(5, 0, 0), dt=0.0,
    )
    r_a = drive(
        engine, clock, server_key="server-a", guid="g1", car_id=3,
        pos=(250, 0, 0), vel=(5, 0, 0), dt=0.05,
    )
    r_b = drive(
        engine, clock, server_key="server-b", guid="g1", car_id=3,
        pos=(0.25, 0, 0), vel=(5, 0, 0), dt=0.05,
    )
    assert any(a.rule_id == "position_jump" for a in r_a.anomalies)
    assert r_b.anomalies == []
    assert engine.store.player_count() == 2
