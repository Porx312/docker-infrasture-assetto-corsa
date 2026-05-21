import time

from engines.battlesystem.models import CarState
from engines.battlesystem.rules.finish import lead_completed_run


def test_driven_spline_counts_finish_line_crossing():
    car = CarState("g")
    car.begin_run(0.99)
    car.spline = 0.99
    car.last_update_time = time.time() - 0.1
    car.update(0.005, 100.0, (0, 0, 0))
    assert car.driven_spline >= 0.01


def test_lead_completed_on_finish_line_cross_after_min_progress():
    car = CarState("g")
    car.begin_run(0.5)
    car.spline = 0.5
    car.driven_spline = 0.35
    car.last_update_time = time.time() - 0.1
    car.update(0.05, 100.0, (0, 0, 0))
    assert car.run_lap_completed is False

    car.spline = 0.92
    car.update(0.05, 100.0, (0, 0, 0))
    assert car.run_lap_completed is True
    assert lead_completed_run(car) is True


def test_mid_lap_start_no_instant_finish_at_line():
    car = CarState("g")
    car.begin_run(0.02)
    car.spline = 0.02
    car.last_update_time = time.time() - 0.1
    car.update(0.05, 100.0, (0, 0, 0))
    assert car.run_lap_completed is False


def test_mark_lap_completed_accepts_acsp_event():
    car = CarState("g")
    car.begin_run(0.5)
    assert lead_completed_run(car) is False
    car.mark_lap_completed()
    assert lead_completed_run(car) is True
