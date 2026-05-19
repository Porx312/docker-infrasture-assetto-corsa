import time

from engines.battlesystem.rules import overtake
from engines.battlesystem.rules.proximity import is_ahead_on_track
from tests.battlesystem.conftest import seed_car


def test_is_ahead_on_track_respects_margin():
    assert is_ahead_on_track(0.31, 0.30, margin=0.005) is True
    assert is_ahead_on_track(0.302, 0.30, margin=0.005) is False
    assert is_ahead_on_track(0.3004, 0.30, margin=0.0003) is True


def test_overtake_requires_gap_between_10_and_15m(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time() - 10
    pair_manager._last_overtake_point_ts = 0
    pair_manager._overtake_chase_scored = False
    overtake.reset_overtake_tracking(pair_manager)

    lead = seed_car(pair_manager, "guid_a", spline=0.30, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", spline=0.31, pos=(40, 0, 0))

    result = overtake.try_score_active_points(pair_manager, lead, chase, 40.0, time.time())
    assert result is None

    chase.pos = (5, 0, 0)
    result = overtake.try_score_active_points(pair_manager, lead, chase, 5.0, time.time())
    assert result is None

    chase.pos = (12, 0, 0)
    result = overtake.try_score_active_points(pair_manager, lead, chase, 12.0, time.time())
    assert result == ("guid_b", "overtake")


def test_overtake_on_pass_crossing_with_small_spline_gap(pair_manager):
    """Pass while close: chase only slightly ahead on spline (within pass margin)."""
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time() - 10
    pair_manager._last_overtake_point_ts = 0
    pair_manager._overtake_chase_scored = False
    overtake.reset_overtake_tracking(pair_manager)

    lead = seed_car(pair_manager, "guid_a", spline=0.30, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", spline=0.29, pos=(10, 0, 0))
    overtake.try_score_active_points(pair_manager, lead, chase, 10.0, time.time())

    chase.spline = 0.3004
    result = overtake.try_score_active_points(pair_manager, lead, chase, 12.0, time.time())
    assert result == ("guid_b", "overtake")


def test_overtake_not_scored_when_chase_behind_on_spline(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time() - 10
    pair_manager._last_overtake_point_ts = 0
    pair_manager._overtake_chase_scored = False
    overtake.reset_overtake_tracking(pair_manager)

    lead = seed_car(pair_manager, "guid_a", spline=0.30, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", spline=0.29, pos=(10, 0, 0))

    result = overtake.try_score_active_points(pair_manager, lead, chase, 10.0, time.time())
    assert result is None


def test_recovery_after_overtake(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time() - 10
    pair_manager._last_overtake_point_ts = 0
    pair_manager._overtake_chase_scored = True
    overtake.reset_overtake_tracking(pair_manager)
    pair_manager._chase_was_ahead_on_track = True

    lead = seed_car(pair_manager, "guid_a", spline=0.48, pos=(5, 0, 0))
    chase = seed_car(pair_manager, "guid_b", spline=0.50, pos=(30, 0, 0))

    result = overtake.try_score_active_points(pair_manager, lead, chase, 30.0, time.time())
    assert result is None

    lead.spline = 0.5004
    chase.spline = 0.48
    result = overtake.try_score_active_points(pair_manager, lead, chase, 12.0, time.time())
    assert result == ("guid_a", "position_recovery")
