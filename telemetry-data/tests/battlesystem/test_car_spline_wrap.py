import time

from engines.battlesystem.models import CarState
from engines.battlesystem.rules.finish import lead_completed_run


def test_driven_spline_counts_finish_line_crossing():
    car = CarState("g")
    car.spline = 0.99
    car.last_update_time = time.time() - 0.1
    car.update(0.005, 100.0, (0, 0, 0))
    assert car.driven_spline >= 0.01


def test_lead_completed_run_uses_spline_near_finish():
    car = CarState("g")
    car.driven_spline = 0.8
    car.spline = 0.01
    assert lead_completed_run(car) is True
