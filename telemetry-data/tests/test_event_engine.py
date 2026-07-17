from engines.event_engine import TimeAttackEngine
from core.session_manager import DriverInfo


class _FakeServerState:
    pass


def _engine():
    chats = []
    admin_cmds = []
    engine = TimeAttackEngine(
        send_chat_callback=lambda car_id, msg: chats.append((car_id, msg)),
        send_admin_command_callback=lambda cmd: admin_cmds.append(cmd),
        server_state_ref=_FakeServerState(),
    )
    return engine, chats, admin_cmds


def test_evaluate_lap_rejects_track_cut():
    engine, chats, admin_cmds = _engine()
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 0
    driver.lap_count = 2

    is_valid, reason = engine.evaluate_lap(driver, ac_lap_time=120_000, cuts=1, meta={})

    assert is_valid is False
    assert reason == "Track Cut / Teleport"
    assert chats == []
    assert admin_cmds == []


def test_evaluate_lap_rejects_idle_when_enabled():
    engine, chats, admin_cmds = _engine()
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 0
    driver.lap_count = 2
    driver.was_idle = True

    is_valid, reason = engine.evaluate_lap(
        driver,
        ac_lap_time=120_000,
        cuts=0,
        meta={"detectIdle": True, "maxFails": 3},
    )

    assert is_valid is False
    assert reason == "Stopped on track (>5s)"
    assert len(chats) == 1
    assert "/pit 0" in admin_cmds[0]


def test_check_collision_marks_lap_failed_when_enabled():
    engine, chats, admin_cmds = _engine()
    driver = DriverInfo("Pilot", "76561199000000001", "ks_toyota_gt86")
    driver.car_id = 0
    driver.has_left_pits = True

    engine.check_collision(driver, {"enableCollisions": True, "maxFails": 2})

    assert driver.had_collision is True
    assert driver.failed_laps == 1
    assert len(chats) == 1
    assert admin_cmds == ["/pit 0"]
