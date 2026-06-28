"""HUD publish kwargs from scoring terminal paths."""

from unittest.mock import patch

import pytest

from core import settings
from engines.battlesystem.scoring import (
    award_point,
    finalize_abandon,
    finalize_default_win,
    finalize_single_session_result,
)
from tests.battlesystem.conftest import seed_car


@pytest.fixture
def hud_pair_manager(pair_manager):
    hud_calls = []
    pair_manager._publish_hud = lambda **kwargs: hud_calls.append(kwargs)
    pair_manager.on_chat_message = None
    pair_manager.on_score_update = None
    return pair_manager, hud_calls


@patch.object(settings, "BATTLE_HUD_ENABLED", True)
def test_finalize_abandon_cancel_publishes_hud_metadata(hud_pair_manager):
    mgr, calls = hud_pair_manager
    mgr.state = "ACTIVE"
    mgr.battle.car1_score = 0
    mgr.battle.car2_score = 0
    seed_car(mgr, "guid_a", driven=0.02)
    seed_car(mgr, "guid_b", driven=0.01)

    assert finalize_abandon(mgr, "guid_a", "opponent_stalled") is True
    assert len(calls) == 1
    assert calls[0]["hud_state"] == "cancelled"
    assert calls[0]["cancel_reason"] == "opponent_stalled"
    assert calls[0]["end_label"] == "stopped"
    assert calls[0]["last_event"]["reason"] == "opponent_stalled"


@patch.object(settings, "BATTLE_HUD_ENABLED", True)
def test_finalize_default_win_publishes_end_reason(hud_pair_manager):
    mgr, calls = hud_pair_manager
    mgr.state = "ACTIVE"
    seed_car(mgr, "guid_a", driven=0.70)
    seed_car(mgr, "guid_b", driven=0.20)

    assert finalize_abandon(mgr, "guid_a", "gap_disappeared") is True
    assert len(calls) == 1
    assert calls[0]["hud_state"] == "finished"
    assert calls[0]["end_reason"] == "gap_disappeared"
    assert calls[0]["end_label"] == "win"
    assert calls[0]["last_event"]["scorerSteamId"] == "guid_a"


@patch.object(settings, "BATTLE_HUD_ENABLED", True)
def test_finalize_single_session_result_draw(hud_pair_manager):
    mgr, calls = hud_pair_manager
    mgr.state = "ACTIVE"
    mgr.battle.car1_score = 1
    mgr.battle.car2_score = 1

    finalize_single_session_result(mgr, 12.0, is_draw=True)
    assert len(calls) == 1
    assert calls[0]["hud_state"] == "finished"
    assert calls[0]["finish_gap_m"] == 12.0
    assert calls[0]["end_label"] == "draw"
    assert calls[0]["last_event"]["reason"] == "draw"


@patch.object(settings, "BATTLE_HUD_ENABLED", True)
def test_award_point_publishes_last_event(hud_pair_manager):
    mgr, calls = hud_pair_manager
    mgr.state = "ACTIVE"

    award_point(mgr, "guid_a", reason="position_recovery", skip_chat=True)
    assert len(calls) == 1
    assert calls[0]["hud_state"] == "active"
    assert calls[0]["last_event"]["reason"] == "position_recovery"
    assert calls[0]["last_event"]["label"] == "recover"
