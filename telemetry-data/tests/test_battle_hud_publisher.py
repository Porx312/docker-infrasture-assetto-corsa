"""Tests for battle HUD Redis publisher."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from engines.battlesystem.models import CarState, TougeBattle
from engines.battlesystem.config import DISAPPEAR_GAP_METERS
from engines.battlesystem.pair_manager import PairBattleManager
from network import battle_hud_publisher as publisher


class _FakeRedis:
    def __init__(self):
        self.store = {}
        self.published = []

    def set(self, key, value, ex=None):
        self.store[key] = value

    def delete(self, *keys):
        for key in keys:
            self.store.pop(key, None)

    def publish(self, channel, message):
        self.published.append((channel, message))


class _FakeServerState:
    def __init__(self):
        self.config_server_name = "Battle Test"
        self.track = "pk_akina"
        self.config = "downhill"
        self.guid_to_driver = {}


@pytest.fixture(autouse=True)
def reset_publisher_state():
    publisher.reset_debounce_for_tests()
    yield
    publisher.reset_debounce_for_tests()


def _pair_manager():
    mgr = PairBattleManager()
    mgr.battle = TougeBattle("steam-a", "steam-b")
    mgr.player_names = {"steam-a": "Alice", "steam-b": "Bob"}
    mgr.state = "ACTIVE"
    mgr.battle_id = "battle-abc123"
    mgr.battle.car1_score = 1
    mgr.battle.car2_score = 0
    mgr.battle.lead_guid = "steam-a"
    mgr.battle.chase_guid = "steam-b"
    mgr.battle.points_log = [
        {"scorer": "steam-a", "reason": "overtake", "ts": 1_700_000_000_000}
    ]
    mgr.cars["steam-a"] = CarState("steam-a")
    mgr.cars["steam-a"].pos = (0.0, 0.0, 0.0)
    mgr.cars["steam-b"] = CarState("steam-b")
    mgr.cars["steam-b"].pos = (100.0, 0.0, 0.0)
    return mgr


@patch.object(publisher.settings, "BATTLE_HUD_ENABLED", True)
@patch.object(publisher.settings, "REDIS_HOST", "localhost")
@patch.object(publisher, "get_redis_client")
def test_publish_writes_both_player_keys(mock_get_redis):
    redis = _FakeRedis()
    mock_get_redis.return_value = redis
    server = _FakeServerState()
    mgr = _pair_manager()

    publisher.publish_battle_hud(server, mgr, hud_state="active", force=True)

    key_a = publisher._battle_cache_key("battle_test", "steam-a")
    key_b = publisher._battle_cache_key("battle_test", "steam-b")
    assert key_a in redis.store
    assert key_b in redis.store
    payload_a = json.loads(redis.store[key_a])
    assert payload_a["ok"] is True
    assert payload_a["state"] == "active"
    assert payload_a["player1"]["name"] == "Alice"
    assert "car_id" in payload_a["player1"]
    assert payload_a["player2"]["score"] == 0
    assert payload_a["pointsLog"][0]["label"] == "overtake"
    assert payload_a["gap3dM"] == 100.0
    assert payload_a["disappearGapM"] == DISAPPEAR_GAP_METERS
    assert len(redis.published) == 2


@patch.object(publisher.settings, "BATTLE_HUD_ENABLED", True)
@patch.object(publisher.settings, "REDIS_HOST", "localhost")
@patch.object(publisher, "get_redis_client")
def test_clear_removes_player_keys(mock_get_redis):
    redis = _FakeRedis()
    mock_get_redis.return_value = redis
    server = _FakeServerState()
    key_a = publisher._battle_cache_key("battle_test", "steam-a")
    redis.store[key_a] = "{}"

    publisher.clear_battle_hud(server, ["steam-a", "steam-b"])

    assert key_a not in redis.store


def test_normalize_hud_key_part():
    assert publisher.normalize_hud_key_part("Project D") == "project_d"


def test_format_point_label():
    assert publisher.format_point_label("overtake") == "overtake"
    assert publisher.format_point_label("position_recovery") == "recover"
    assert publisher.format_point_label("unknown_reason") == "unknown_reason"


def test_build_battle_snapshot_includes_gap_fields():
    server = _FakeServerState()
    mgr = _pair_manager()
    snapshot = publisher.build_battle_snapshot(server, mgr, hud_state="active")
    assert snapshot["gap3dM"] == 100.0
    assert snapshot["disappearGapM"] == DISAPPEAR_GAP_METERS


def test_build_battle_snapshot_terminal_cancel_fields():
    server = _FakeServerState()
    mgr = _pair_manager()
    last_event = publisher.make_hud_event("opponent_stopped", "stopped")
    snapshot = publisher.build_battle_snapshot(
        server,
        mgr,
        hud_state="cancelled",
        cancel_reason="opponent_stopped",
        end_label="stopped",
        last_event=last_event,
    )
    assert snapshot["state"] == "cancelled"
    assert snapshot["status"] == "cancelled"
    assert snapshot["cancelReason"] == "opponent_stopped"
    assert snapshot["endLabel"] == "stopped"
    assert snapshot["lastEvent"]["reason"] == "opponent_stopped"


def test_build_battle_snapshot_terminal_finish_fields():
    server = _FakeServerState()
    mgr = _pair_manager()
    mgr.battle.winner = "steam-a"
    end_label = "win"
    snapshot = publisher.build_battle_snapshot(
        server,
        mgr,
        hud_state="finished",
        finish_gap_m=120.0,
        end_label=end_label,
        last_event=publisher.make_hud_event("finish_outrun", end_label, scorer_steam_id="steam-a"),
    )
    assert snapshot["state"] == "finished"
    assert snapshot["status"] == "finished"
    assert snapshot["winnerSteamId"] == "steam-a"
    assert snapshot["finishGapM"] == 120.0
    assert snapshot["endLabel"] == end_label


def test_format_cancel_and_abandon_labels():
    mgr = _pair_manager()
    assert publisher.format_cancel_label("opponent_stalled") == "stopped"
    assert publisher.format_cancel_label("arming_aborted") == "cancel"
    assert publisher.format_cancel_label("prestart_gap") == "cancel"
    assert publisher.format_abandon_win_label(mgr, "steam-a", "gap_disappeared") == "win"
    assert publisher.format_finish_session_label(mgr, 50.0, is_draw=True, winner_guid=None) == "draw"
    assert publisher.format_finish_session_label(mgr, 50.0, is_draw=False, winner_guid="steam-a") == "win"


@patch.object(publisher.settings, "BATTLE_HUD_ENABLED", True)
@patch.object(publisher.settings, "REDIS_HOST", "localhost")
@patch.object(publisher.settings, "HUD_BATTLE_CLEAR_DELAY_SEC", 0)
@patch.object(publisher, "get_redis_client")
def test_schedule_clear_battle_hud_deletes_after_delay(mock_get_redis):
    import time as time_module

    redis = _FakeRedis()
    mock_get_redis.return_value = redis
    server = _FakeServerState()
    key_a = publisher._battle_cache_key("battle_test", "steam-a")
    redis.store[key_a] = "{}"

    publisher.schedule_clear_battle_hud(server, ["steam-a"])
    time_module.sleep(0.05)
    assert key_a not in redis.store
    publisher.reset_debounce_for_tests()
