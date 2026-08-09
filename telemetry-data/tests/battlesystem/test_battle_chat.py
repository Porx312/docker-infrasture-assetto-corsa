import time
from unittest.mock import patch

import pytest

from core.hud_sse_presence import reset_hud_sse_presence_cache_for_tests
from engines.battlesystem.chat import (
    format_arming_countdown,
    format_point_broadcast,
    notify_arming_cancelled,
    notify_arming_countdown,
    notify_player_chat,
    notify_touge_chat,
)
from engines.battlesystem.config import ARM_SUSTAINED_PROXIMITY_SEC, BATTLE_ARM_MIN_SPEED_KMH
from engines.battlesystem.scoring import award_point, finalize_abandon
from engines.battlesystem.state_machine import process_pair_logic
from tests.battlesystem.conftest import seed_car


@pytest.fixture(autouse=True)
def _reset_hud_cache():
    reset_hud_sse_presence_cache_for_tests()
    yield
    reset_hud_sse_presence_cache_for_tests()


def _chat_recorder(pair_manager):
    messages = []

    def record(guid, message):
        messages.append((guid, message))

    pair_manager.on_chat_message = record
    return messages


@patch("engines.battlesystem.chat.has_hud_overlay_connected")
def test_notify_touge_chat_skips_hud_player(mock_overlay, pair_manager):
    mock_overlay.side_effect = lambda guid: guid == "guid_a"
    messages = _chat_recorder(pair_manager)

    notify_touge_chat(pair_manager, "hello battle")

    assert messages == [("guid_b", "hello battle")]


@patch("engines.battlesystem.chat.has_hud_overlay_connected", return_value=False)
def test_arming_countdown_reaches_both_without_overlay(_mock_overlay, pair_manager):
    messages = _chat_recorder(pair_manager)
    pair_manager.player_names["guid_a"] = "Alpha"
    pair_manager.player_names["guid_b"] = "Beta"

    notify_arming_countdown(pair_manager, 3)

    expected = format_arming_countdown(pair_manager, 3)
    assert ("guid_a", expected) in messages
    assert ("guid_b", expected) in messages


@patch("engines.battlesystem.chat.has_hud_overlay_connected", return_value=False)
def test_arming_cancel_notifies_both(_mock_overlay, pair_manager):
    messages = _chat_recorder(pair_manager)

    notify_arming_cancelled(pair_manager)

    assert len(messages) == 2
    assert all("BATTLE CANCELLED" in msg for _, msg in messages)


@patch("engines.battlesystem.chat.has_hud_overlay_connected", return_value=False)
def test_idle_armed_and_go_chat(_mock_overlay, pair_manager):
    messages = _chat_recorder(pair_manager)
    pair_manager.state = "IDLE"
    pair_manager.player_names["guid_a"] = "Alpha"
    pair_manager.player_names["guid_b"] = "Beta"
    seed_car(pair_manager, "guid_a", pos=(0, 0, 0), speed=50.0)
    seed_car(pair_manager, "guid_b", pos=(10, 0, 0), speed=50.0)

    now = time.time()
    pair_manager.arm_proximity_since = now - (ARM_SUSTAINED_PROXIMITY_SEC + 0.1)
    process_pair_logic(pair_manager)
    assert pair_manager.state == "ARMED"
    assert any("ARMED" in msg for _, msg in messages)

    seed_car(pair_manager, "guid_a", speed=BATTLE_ARM_MIN_SPEED_KMH + 5)
    seed_car(pair_manager, "guid_b", speed=BATTLE_ARM_MIN_SPEED_KMH + 5)
    process_pair_logic(pair_manager)
    assert pair_manager.state == "LAUNCHING"
    assert any("GO" in msg for _, msg in messages)


@patch("engines.battlesystem.chat.has_hud_overlay_connected")
def test_lead_chase_only_to_player_without_hud(mock_overlay, pair_manager):
    mock_overlay.side_effect = lambda guid: guid == "guid_a"
    messages = _chat_recorder(pair_manager)
    pair_manager.state = "LAUNCHING"
    pair_manager.launch_trigger_time = time.time() - 10.0
    seed_car(pair_manager, "guid_a", spline=0.30, speed=50.0, pos=(0, 0, 0))
    seed_car(pair_manager, "guid_b", spline=0.20, speed=50.0, pos=(5, 0, 0))

    process_pair_logic(pair_manager)

    assert pair_manager.state == "ACTIVE"
    lead_msgs = [(guid, msg) for guid, msg in messages if "LEAD" in msg]
    chase_msgs = [(guid, msg) for guid, msg in messages if "CHASE" in msg]
    assert lead_msgs == []
    assert chase_msgs == [("guid_b", "You are CHASE")]


@patch("engines.battlesystem.chat.has_hud_overlay_connected", return_value=False)
def test_point_broadcast_via_award_point(_mock_overlay, pair_manager):
    messages = _chat_recorder(pair_manager)
    pair_manager.state = "ACTIVE"

    award_point(pair_manager, "guid_a", reason="overtake")

    assert len(messages) == 2
    expected = format_point_broadcast(pair_manager, "guid_a", "overtake")
    assert all(msg == expected for _, msg in messages)


@patch("engines.battlesystem.chat.has_hud_overlay_connected", return_value=False)
def test_finalize_abandon_cancel_chat(_mock_overlay, pair_manager):
    messages = _chat_recorder(pair_manager)
    pair_manager.state = "ACTIVE"
    seed_car(pair_manager, "guid_a", spline=0.01, speed=50.0)
    seed_car(pair_manager, "guid_b", spline=0.01, speed=50.0)

    finalize_abandon(pair_manager, "guid_a", "gap_disappeared")

    assert pair_manager.state == "FINISHED"
    assert any("CANCELLED" in msg for _, msg in messages)


@patch("engines.battlesystem.chat.has_hud_overlay_connected", return_value=True)
def test_chat_skipped_when_overlay_connected(_mock_overlay, pair_manager):
    messages = _chat_recorder(pair_manager)

    notify_player_chat(pair_manager, "guid_a", "hidden")
    notify_touge_chat(pair_manager, "hidden")

    assert messages == []
