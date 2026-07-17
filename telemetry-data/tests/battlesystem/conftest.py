import time

import pytest

from engines.battlesystem.models import CarState, TougeBattle
from engines.battlesystem.pair_manager import PairBattleManager


@pytest.fixture
def pair_manager():
    mgr = PairBattleManager()
    mgr.set_server_mode(True)
    mgr.battle = TougeBattle("guid_a", "guid_b")
    mgr.battle.lead_guid = "guid_a"
    mgr.battle.chase_guid = "guid_b"
    return mgr


def seed_car(mgr, guid, spline=0.1, speed=50.0, pos=(0.0, 0.0, 0.0), driven=0.0):
    car = CarState(guid)
    car.spline = spline
    car.speed = speed
    car.pos = pos
    car.driven_spline = driven
    car.last_update_time = time.time()
    mgr.cars[guid] = car
    return car
