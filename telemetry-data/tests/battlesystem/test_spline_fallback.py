import time
from unittest.mock import patch

from engines.battlesystem.config import ABANDON_MIN_PROGRESS_METERS, BATTLE_ARM_MIN_SPEED_KMH
from engines.battlesystem.models import CarState
from engines.battlesystem.rules import finish
from engines.battlesystem.rules.overtake import try_score_active_points
from engines.battlesystem.rules import arming
from engines.battlesystem.rules.proximity import (
    is_ahead_by_position,
    pair_needs_position_fallback,
    pair_uses_position_fallback,
    spline_position_unusable,
)
from engines.battlesystem.scoring import abandon_should_award_win, finalize_abandon
from tests.battlesystem.conftest import seed_car


def _simulate_stuck_spline(car: CarState, spline: float, pos, speed: float, vel):
    """Feed updates that move in 3D but keep spline frozen (no fast_lane.ai)."""
    t0 = 1_000_000.0
    tick = [0]

    def fake_time():
        tick[0] += 1
        return t0 + tick[0]

    with patch("engines.battlesystem.models.time.time", side_effect=fake_time):
        car.update(spline, speed, pos, vel=vel)
        car.update(spline, speed, (pos[0] + 20.0, pos[1], pos[2]), vel=vel)
        car.update(spline, speed, (pos[0] + 50.0, pos[1], pos[2]), vel=vel)
    return car


def test_spline_stuck_marks_unreliable():
    car = _simulate_stuck_spline(CarState("guid_a"), 0.0, (0, 0, 0), 50.0, (20.0, 0.0, 0.0))
    assert car.spline_reliable is False


def test_spline_stuck_at_arm_speed_threshold():
    """Spline unreliable detection uses min(25, BATTLE_ARM_MIN_SPEED_KMH) by default."""
    speed = max(BATTLE_ARM_MIN_SPEED_KMH, 20.0)
    car = _simulate_stuck_spline(CarState("guid_b"), 0.0, (0, 0, 0), speed, (20.0, 0.0, 0.0))
    assert car.spline_reliable is False


def test_is_ahead_by_position_when_spline_zero():
    lead = _simulate_stuck_spline(CarState("lead"), 0.0, (100, 0, 0), 60.0, (20.0, 0.0, 0.0))
    chase = _simulate_stuck_spline(CarState("chase"), 0.0, (0, 0, 0), 55.0, (18.0, 0.0, 0.0))
    assert pair_uses_position_fallback(lead, chase)
    assert is_ahead_by_position(lead, chase) is True
    assert is_ahead_by_position(chase, lead) is False


def test_setup_active_forces_position_mode_when_spline_zero(pair_manager):
    car1 = seed_car(pair_manager, "guid_a", spline=0.0, speed=50.0, pos=(0, 0, 0))
    car2 = seed_car(pair_manager, "guid_b", spline=0.0, speed=50.0, pos=(15, 0, 0))
    assert spline_position_unusable(car1)
    arming.setup_active_run(pair_manager, car1, car2, time.time())
    assert pair_manager._position_fallback is True
    assert pair_manager.cars["guid_a"].spline_reliable is False


def test_overtake_scores_with_position_fallback(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.active_start_time = time.time() - 10.0
    pair_manager.battle.lead_guid = "guid_a"
    pair_manager.battle.chase_guid = "guid_b"
    pair_manager._position_fallback = True
    pair_manager._overtake_chase_scored = False

    lead = seed_car(pair_manager, "guid_a", spline=0.0, speed=50.0, pos=(0, 0, 0))
    chase = seed_car(pair_manager, "guid_b", spline=0.0, speed=50.0, pos=(12, 0, 0))
    lead.spline_reliable = False
    chase.spline_reliable = False
    lead.vel = (15.0, 0.0, 0.0)
    chase.vel = (17.0, 0.0, 0.0)
    lead._chase_was_ahead_on_track = False
    chase._lead_was_ahead_on_track = False

    assert pair_needs_position_fallback(lead, chase, manager=pair_manager)

    result = try_score_active_points(pair_manager, lead, chase, 12.0, time.time())
    assert result is not None
    winner, reason = result
    assert winner == "guid_b"
    assert reason == "overtake"


def test_abandon_uses_position_when_spline_frozen(pair_manager):
    pair_manager.battle.lead_guid = "guid_a"
    pair_manager.battle.chase_guid = "guid_b"
    lead = seed_car(pair_manager, "guid_a", spline=0.0, speed=70.0, pos=(200, 0, 0), driven=0.0)
    chase = seed_car(pair_manager, "guid_b", spline=0.0, speed=60.0, pos=(0, 0, 0), driven=0.0)
    lead.spline_reliable = False
    chase.spline_reliable = False
    lead.vel = (0.0, 0.0, 20.0)
    chase.vel = (0.0, 0.0, 15.0)

    winner = finish.check_abandon_by_gap(pair_manager, lead, chase, 260.0)
    assert winner == "guid_a"


def test_driven_distance_progress_for_abandon_win(pair_manager):
    pair_manager.state = "ACTIVE"
    pair_manager.battle.car1_score = 0
    pair_manager.battle.car2_score = 0
    pair_manager._position_fallback = True
    lead = seed_car(pair_manager, "guid_a", spline=0.0, speed=50.0)
    chase = seed_car(pair_manager, "guid_b", spline=0.0, speed=50.0)
    lead.spline_reliable = False
    chase.spline_reliable = False
    lead.driven_distance_m = ABANDON_MIN_PROGRESS_METERS + 10.0
    chase.driven_distance_m = 50.0

    assert abandon_should_award_win(pair_manager) is True
    pair_manager.on_chat_message = None
    assert finalize_abandon(pair_manager, "guid_a", "gap_disappeared") is True
    assert pair_manager.battle.winner == "guid_a"
