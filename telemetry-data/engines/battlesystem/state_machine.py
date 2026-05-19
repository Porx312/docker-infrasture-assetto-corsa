"""Thin state machine coordinator for touge pair battles."""

from __future__ import annotations

import time

from core.logging_config import get_logger
from engines.battlesystem.config import (
    BATTLE_ARM_MIN_SPEED_KMH,
    FINISHED_COOLDOWN_SEC,
    LAUNCH_TIMEOUT_SEC,
    PAIR_STICKY_TIMEOUT_SEC,
)
from engines.battlesystem.models import TougeBattle
from engines.battlesystem.rules import arming, finish, overtake
from engines.battlesystem.rules.proximity import distance_3d

log = get_logger("battlesystem.state")


def process_pair_logic(manager):
    now = time.time()
    if not manager.is_battle_server:
        return

    if not manager.battle:
        return

    active_guids = [g for g, c in manager.cars.items() if (now - c.last_update_time) < 5.0]
    p1 = manager.cars.get(manager.battle.car1_guid)
    p2 = manager.cars.get(manager.battle.car2_guid)

    if len(active_guids) < 2:
        if manager.state not in ("IDLE", "FINISHED"):
            manager._notify_battle_cancelled("not enough players")
            log.info("not enough players (%d), resetting", len(active_guids))
            manager._reset_to_idle(full_reset=True)
        return

    if not p1 or not p2:
        if manager.state not in ("IDLE", "FINISHED"):
            manager._notify_battle_cancelled("pair missing")
            log.warning("active pair missing from car state, resetting")
        manager._reset_to_idle(full_reset=True)
        manager.battle = None
        return

    p1_stale = (now - p1.last_update_time) > PAIR_STICKY_TIMEOUT_SEC
    p2_stale = (now - p2.last_update_time) > PAIR_STICKY_TIMEOUT_SEC
    if p1_stale or p2_stale:
        if manager.state == "ACTIVE":
            remaining_guid = None
            if p1_stale and not p2_stale:
                remaining_guid = manager.battle.car2_guid
            elif p2_stale and not p1_stale:
                remaining_guid = manager.battle.car1_guid
            if remaining_guid and manager._finalize_abandon(remaining_guid, "opponent_disconnected"):
                return
        if manager.state not in ("IDLE", "FINISHED"):
            manager._notify_battle_cancelled("pair stale")
            log.info("pair stale timeout, resetting")
        manager._reset_to_idle(full_reset=True)
        manager.battle = None
        if getattr(manager, "on_battle_end", None):
            manager.on_battle_end()
        return

    if manager.battle.car1_guid not in active_guids or manager.battle.car2_guid not in active_guids:
        if manager.state in ("ARMED", "LAUNCHING", "ACTIVE"):
            if manager.battle.car1_guid not in active_guids:
                remaining = manager.battle.car2_guid
            else:
                remaining = manager.battle.car1_guid
            manager._finalize_abandon(remaining, "opponent_inactive")
        return

    if manager.state == "FINISHED":
        _handle_finished_cooldown(manager, p1, p2, now)
        return

    car1, car2 = p1, p2
    distance = distance_3d(car1.pos, car2.pos)

    if manager.state == "IDLE":
        _handle_idle(manager, car1, car2, distance, now)
    elif manager.state == "ARMED":
        _handle_armed(manager, car1, car2, distance, now)
    elif manager.state == "LAUNCHING":
        _handle_launching(manager, car1, car2, distance, now)
    elif manager.state == "ACTIVE":
        _handle_active(manager, car1, car2, distance, now)


def _handle_finished_cooldown(manager, car1, car2, now: float) -> None:
    if manager.finished_time == 0.0:
        manager.finished_time = now
        return

    elapsed = now - manager.finished_time
    if elapsed < FINISHED_COOLDOWN_SEC:
        return

    log.info("rematch cooldown over (%.0fs), ready for new battle", elapsed)
    if manager.battle:
        manager.battle = TougeBattle(manager.battle.car1_guid, manager.battle.car2_guid)
    manager._reset_to_idle(full_reset=True)
    if getattr(manager, "on_battle_end", None):
        manager.on_battle_end()


def _handle_idle(manager, car1, car2, distance: float, now: float) -> None:
    if manager.finished_time > 0 and (now - manager.finished_time) < FINISHED_COOLDOWN_SEC:
        return
    if not arming.can_arm(car1, car2):
        return
    manager.state = "ARMED"
    manager.condition_start_time = now
    log.info("ARMED %s vs %s gap=%.1fm", car1.guid, car2.guid, distance)
    if manager.on_chat_message:
        msg = f"{manager._display_name(car1.guid)} vs {manager._display_name(car2.guid)} — ARMED"
        manager.on_chat_message(car1.guid, msg)
        manager.on_chat_message(car2.guid, msg)


def _handle_armed(manager, car1, car2, distance: float, now: float) -> None:
    if arming.should_abort_prestart(distance, car1, car2, manager.condition_start_time, now):
        manager._abort_run_no_point(f"prestart_gap_{distance:.1f}m")
        return

    if manager.battle_id is None and manager.on_battle_start:
        manager.battle_id = manager.on_battle_start(manager.battle.car1_guid, manager.battle.car2_guid)

    if arming.can_launch(car1, car2):
        manager.state = "LAUNCHING"
        manager.launch_trigger_time = now
        log.info("LAUNCHING gap=%.1fm both > %.0f km/h", distance, BATTLE_ARM_MIN_SPEED_KMH)
        if manager.on_chat_message:
            msg = "GO — both over 40 km/h"
            manager.on_chat_message(car1.guid, msg)
            manager.on_chat_message(car2.guid, msg)
    elif manager.launch_trigger_time and (now - manager.launch_trigger_time) > LAUNCH_TIMEOUT_SEC:
        log.info("launch timeout in ARMED, resetting")
        manager._reset_to_idle()


def _handle_launching(manager, car1, car2, distance: float, now: float) -> None:
    if arming.should_abort_prestart(distance, car1, car2, manager.launch_trigger_time, now):
        manager._abort_run_no_point(f"launch_gap_{distance:.1f}m")
        return

    if not arming.can_launch(car1, car2):
        if (now - manager.launch_trigger_time) > LAUNCH_TIMEOUT_SEC:
            log.info("launch timeout, resetting")
            manager._reset_to_idle()
        return

    ok, abort_reason = arming.can_assign_roles(car1, car2, manager.launch_trigger_time, now)
    if not ok:
        if abort_reason:
            manager._abort_run_no_point(abort_reason)
        return

    arming.setup_active_run(manager, car1, car2, now)
    manager.state = "ACTIVE"
    log.info(
        "ACTIVE lead=%s chase=%s initial_gap=%.4f",
        manager.battle.lead_guid,
        manager.battle.chase_guid,
        manager.battle.initial_gap_spline,
    )
    if manager.on_chat_message:
        manager.on_chat_message(manager.battle.lead_guid, "You are LEAD")
        manager.on_chat_message(manager.battle.chase_guid, "You are CHASE")


def _handle_active(manager, car1, car2, distance: float, now: float) -> None:
    lead_car = manager.cars[manager.battle.lead_guid]
    chase_car = manager.cars[manager.battle.chase_guid]

    abandon_winner = finish.check_abandon_by_gap(manager, lead_car, chase_car, distance)
    if abandon_winner and manager._finalize_abandon(abandon_winner, "gap_disappeared"):
        return

    scored = overtake.try_score_active_points(manager, lead_car, chase_car, distance, now)
    if scored:
        winner_guid, reason = scored
        if reason == "overtake":
            manager._overtake_chase_scored = True
        else:
            manager._overtake_chase_scored = False
        manager._last_overtake_point_ts = now
        log.info("%s point to %s gap=%.1fm", reason, winner_guid, distance)
        manager._award_point(winner_guid, reason=reason)
        return

    run_result = finish.check_run_finish(manager, lead_car, chase_car)
    if run_result:
        finish_gap_m, is_draw, point_winner = run_result
        if is_draw:
            log.info("FINISH DRAW gap=%.1fm — no finish point", finish_gap_m)
        else:
            log.info("FINISH POINT lead gap=%.1fm", finish_gap_m)
            manager._award_point(point_winner, reason="finish_outrun", skip_chat=True)
        manager._finalize_single_session_result(finish_gap_m, is_draw)
