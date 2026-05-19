from engines.battlesystem.config import RUN_END_SPLINE_FRACTION
from engines.battlesystem.rules import finish
from tests.battlesystem.conftest import seed_car


def test_finish_at_full_lap(pair_manager):
    lead = seed_car(pair_manager, "guid_a", driven=RUN_END_SPLINE_FRACTION, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", driven=0.5, pos=(150, 0, 0))

    result = finish.check_run_finish(pair_manager, lead, chase)
    assert result is not None
    finish_gap_m, is_draw, winner = result
    assert is_draw is False
    assert winner == "guid_a"
    assert finish_gap_m >= 100


def test_finish_close_gap_is_draw_no_point(pair_manager):
    lead = seed_car(pair_manager, "guid_a", driven=RUN_END_SPLINE_FRACTION, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", driven=0.5, pos=(30, 0, 0))

    result = finish.check_run_finish(pair_manager, lead, chase)
    assert result is not None
    _, is_draw, winner = result
    assert is_draw is True
    assert winner is None


def test_abandon_chase_stalled_lead_wins(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.5, speed=80.0, driven=0.5)
    chase = seed_car(pair_manager, "guid_b", spline=0.45, speed=5.0, driven=0.4)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_a"


def test_abandon_lead_pulled_away_chase_wins(pair_manager):
    """Lead opens 250m+ by driving off — chase wins, not the one who left."""
    lead = seed_car(pair_manager, "guid_a", spline=0.55, speed=140.0, driven=0.6)
    chase = seed_car(pair_manager, "guid_b", spline=0.50, speed=70.0, driven=0.55)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_b"


def test_abandon_chase_fell_behind_both_moving_lead_wins(pair_manager):
    lead = seed_car(pair_manager, "guid_a", spline=0.52, speed=70.0, driven=0.5)
    chase = seed_car(pair_manager, "guid_b", spline=0.48, speed=60.0, driven=0.42)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_a"
