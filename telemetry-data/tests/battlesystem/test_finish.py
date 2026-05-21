from engines.battlesystem.config import FINISH_POINT_MIN_GAP_METERS
from engines.battlesystem.rules import finish
from tests.battlesystem.conftest import seed_car


def test_finish_at_full_lap(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.31, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", driven=0.5, spline=0.30, pos=(120, 0, 0))
    lead.run_active = True
    lead.run_lap_completed = True

    result = finish.check_run_finish(pair_manager, lead, chase)
    assert result is not None
    finish_gap_m, is_draw, winner = result
    assert is_draw is False
    assert winner == "guid_a"
    assert finish_gap_m >= FINISH_POINT_MIN_GAP_METERS


def test_finish_close_gap_is_draw_no_point(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.31, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", driven=0.5, spline=0.30, pos=(15, 0, 0))
    lead.run_lap_completed = True

    result = finish.check_run_finish(pair_manager, lead, chase)
    assert result is not None
    _, is_draw, winner = result
    assert is_draw is True
    assert winner is None


def test_finish_chase_ahead_gets_point(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.30, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", driven=0.5, spline=0.31, pos=(120, 0, 0))
    lead.run_lap_completed = True

    result = finish.check_run_finish(pair_manager, lead, chase)
    assert result is not None
    finish_gap_m, is_draw, winner = result
    assert is_draw is False
    assert winner == "guid_b"
    assert finish_gap_m >= FINISH_POINT_MIN_GAP_METERS


def test_finish_not_triggered_without_lap_complete(pair_manager):
    lead = seed_car(pair_manager, "guid_a", driven=0.99, spline=0.31, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", driven=0.5, spline=0.30, pos=(120, 0, 0))
    lead.run_lap_completed = False

    assert finish.check_run_finish(pair_manager, lead, chase) is None


def test_abandon_chase_stalled_lead_wins(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.5, speed=80.0, driven=0.5)
    chase = seed_car(pair_manager, "guid_b", spline=0.45, speed=5.0, driven=0.4)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_a"


def test_abandon_chase_ahead_on_track_chase_wins(pair_manager):
    """Chase ahead on track at 250m+ gap — chase stayed in front, lead fell behind."""
    lead = seed_car(pair_manager, "guid_a", spline=0.50, speed=80.0, driven=0.62)
    chase = seed_car(pair_manager, "guid_b", spline=0.52, speed=75.0, driven=0.55)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_b"


def test_abandon_lead_ahead_on_track_wins_even_if_chase_more_driven(pair_manager):
    """Lead ahead on spline wins; chase must not win on driven_spline alone."""
    lead = seed_car(pair_manager, "guid_a", spline=0.52, speed=70.0, driven=0.50)
    chase = seed_car(pair_manager, "guid_b", spline=0.48, speed=60.0, driven=0.65)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_a"


def test_abandon_chase_fell_behind_both_moving_lead_wins(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.52, speed=70.0, driven=0.5)
    chase = seed_car(pair_manager, "guid_b", spline=0.48, speed=60.0, driven=0.42)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_a"
