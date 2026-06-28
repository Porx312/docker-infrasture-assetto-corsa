"""Thin state machine coordinator for touge pair battles."""

from __future__ import annotations

import math
import time

from core import settings
from core.logging_config import get_logger
from engines.battlesystem.config import (
    ARM_SUSTAINED_PROXIMITY_SEC,
    BATTLE_ARM_MIN_SPEED_KMH,
    LAUNCH_TIMEOUT_SEC,
    PAIR_IDLE_SEPARATED_RELEASE_SEC,
    PAIR_MAX_PREACTIVE_LOCK_SEC,
    PAIR_STICKY_TIMEOUT_SEC,
)
from engines.battlesystem.chat import (
    format_matchup,
    notify_arming_cancelled,
    notify_arming_countdown,
    notify_position_fallback_mode,
)
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
        _dissolve_pair(manager, reason="pair stale")
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
        _handle_finished_state(manager)
        return

    car1, car2 = p1, p2
    distance = distance_3d(car1.pos, car2.pos)

    if manager.state in ("IDLE", "ARMED", "LAUNCHING"):
        locked_at = getattr(manager, "pair_locked_at", 0.0)
        if locked_at > 0.0 and (now - locked_at) >= PAIR_MAX_PREACTIVE_LOCK_SEC:
            log.info(
                "pair dissolved (pre-active lock %.0fs) %s vs %s",
                now - locked_at,
                manager.battle.car1_guid,
                manager.battle.car2_guid,
            )
            _dissolve_pair(manager, reason="pre_active_timeout")
            return

    if manager.state == "IDLE":
        _handle_idle(manager, car1, car2, distance, now)
    elif manager.state == "ARMED":
        _handle_armed(manager, car1, car2, distance, now)
    elif manager.state == "LAUNCHING":
        _handle_launching(manager, car1, car2, distance, now)
    elif manager.state == "ACTIVE":
        _handle_active(manager, car1, car2, distance, now)

    # Debounced HUD refresh so gap3dM updates for separation bar (see HUD_BATTLE_DEBOUNCE_MS).
    if manager.state in ("IDLE", "ARMED", "LAUNCHING", "ACTIVE"):
        manager._publish_hud()


def _dissolve_pair(manager, *, reason: str, rematch_cooldown: bool = False) -> None:
    steam_ids = []
    if manager.battle:
        log.info(
            "pair dissolved (%s) %s vs %s rematch_cooldown=%s",
            reason,
            manager.battle.car1_guid,
            manager.battle.car2_guid,
            rematch_cooldown,
        )
        steam_ids = [manager.battle.car1_guid, manager.battle.car2_guid]
        from network.battle_hud_publisher import format_cancel_label, make_hud_event

        cancel_label = format_cancel_label(reason)
        manager._publish_hud(
            hud_state="cancelled",
            force=True,
            cancel_reason=reason,
            end_label=cancel_label,
            last_event=make_hud_event(reason, cancel_label),
        )
    manager._reset_to_idle(full_reset=True)
    manager.battle = None
    manager._separated_since = 0.0
    if steam_ids:
        manager._publish_hud(schedule_clear=True, steam_ids=steam_ids)
    if getattr(manager, "on_battle_end", None):
        manager.on_battle_end(rematch_cooldown=rematch_cooldown)


def _handle_finished_state(manager) -> None:
    steam_ids = []
    if manager.battle:
        log.info(
            "battle finished %s vs %s, releasing pair for new opponents",
            manager.battle.car1_guid,
            manager.battle.car2_guid,
        )
        steam_ids = [manager.battle.car1_guid, manager.battle.car2_guid]
    manager._reset_to_idle(full_reset=True)
    manager.battle = None
    manager._separated_since = 0.0
    if steam_ids:
        manager._publish_hud(schedule_clear=True, steam_ids=steam_ids)
    if getattr(manager, "on_battle_end", None):
        manager.on_battle_end(rematch_cooldown=True)


def _arming_seconds_remaining(manager, now: float) -> int:
    elapsed = now - manager.arm_proximity_since
    remaining = ARM_SUSTAINED_PROXIMITY_SEC - elapsed
    if remaining <= 0:
        return 0
    return max(1, int(math.ceil(remaining)))


def _maybe_notify_arming_countdown(manager, now: float) -> None:
    sec = _arming_seconds_remaining(manager, now)
    if sec <= 0:
        return
    announced = getattr(manager, "_arming_countdown_announced_sec", -1)
    if sec == announced:
        return
    manager._arming_countdown_announced_sec = sec
    notify_arming_countdown(manager, sec)
    manager._publish_hud(hud_state="arming", force=True)


def _clear_arming_countdown(manager, *, notify_cancel: bool = False) -> None:
    was_arming = manager.arm_proximity_since > 0.0
    had_announced = getattr(manager, "_arming_countdown_announced_sec", -1) >= 0
    manager.arm_proximity_since = 0.0
    manager._arming_countdown_announced_sec = -1
    if notify_cancel and was_arming and had_announced:
        notify_arming_cancelled(manager)
        from network.battle_hud_publisher import format_cancel_label, make_hud_event

        cancel_label = format_cancel_label("arming_aborted")
        manager._publish_hud(
            hud_state="cancelled",
            force=True,
            cancel_reason="arming_aborted",
            end_label=cancel_label,
            last_event=make_hud_event("arming_aborted", cancel_label),
        )


def _handle_idle(manager, car1, car2, distance: float, now: float) -> None:
    if not arming.can_arm(car1, car2):
        _clear_arming_countdown(manager, notify_cancel=True)
        separated_since = getattr(manager, "_separated_since", 0.0)
        if separated_since <= 0.0:
            manager._separated_since = now
        elif (now - separated_since) >= PAIR_IDLE_SEPARATED_RELEASE_SEC:
            log.info(
                "pair dissolved (separated idle %.0fs) %s vs %s gap=%.1fm",
                now - separated_since,
                car1.guid,
                car2.guid,
                distance,
            )
            _dissolve_pair(manager, reason="separated_idle")
        return
    manager._separated_since = 0.0
    if manager.arm_proximity_since == 0.0:
        manager.arm_proximity_since = now
        manager._arming_countdown_announced_sec = -1
        _maybe_notify_arming_countdown(manager, now)
        return
    if (now - manager.arm_proximity_since) < ARM_SUSTAINED_PROXIMITY_SEC:
        _maybe_notify_arming_countdown(manager, now)
        return
    _clear_arming_countdown(manager, notify_cancel=False)
    manager.state = "ARMED"
    manager.condition_start_time = now
    log.info("ARMED %s vs %s gap=%.1fm", car1.guid, car2.guid, distance)
    cooldown = getattr(manager, "ARMED_CHAT_COOLDOWN", 15.0)
    if (
        not settings.BATTLE_HUD_ENABLED
        and manager.on_chat_message
        and (now - manager.last_armed_chat_time) >= cooldown
    ):
        msg = f"{format_matchup(manager)} — ARMED"
        manager.on_chat_message(car1.guid, msg)
        manager.on_chat_message(car2.guid, msg)
        manager.last_armed_chat_time = now
    if manager.battle_id is None and manager.on_battle_start:
        manager.battle_id = manager.on_battle_start(manager.battle.car1_guid, manager.battle.car2_guid)
    manager._publish_hud(hud_state="armed", force=True)


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
        if not settings.BATTLE_HUD_ENABLED and manager.on_chat_message:
            speed = int(BATTLE_ARM_MIN_SPEED_KMH)
            msg = f"{format_matchup(manager)} — GO — both over {speed} km/h"
            manager.on_chat_message(car1.guid, msg)
            manager.on_chat_message(car2.guid, msg)
        manager._publish_hud(hud_state="launching", force=True)
    elif manager.launch_trigger_time and (now - manager.launch_trigger_time) > LAUNCH_TIMEOUT_SEC:
        log.info("launch timeout in ARMED, resetting")
        manager._reset_to_idle()


def _handle_launching(manager, car1, car2, distance: float, now: float) -> None:
    # Once GO was sent, do not abort for opening gap or brief speed dips.

    ok, _abort_reason = arming.can_assign_roles(car1, car2, manager.launch_trigger_time, now)
    if not ok:
        if (now - manager.launch_trigger_time) > LAUNCH_TIMEOUT_SEC:
            log.info("launch role assign timeout, resetting")
            manager._reset_to_idle()
        return

    arming.setup_active_run(manager, car1, car2, now)
    manager.state = "ACTIVE"
    lead_car = manager.cars[manager.battle.lead_guid]
    chase_car = manager.cars[manager.battle.chase_guid]
    gap_m = distance_3d(lead_car.pos, chase_car.pos)
    log.info(
        "ACTIVE lead=%s chase=%s initial_gap_spline=%.4f gap3d=%.1fm "
        "lead_spline=%.4f chase_spline=%.4f lead_reliable=%s chase_reliable=%s "
        "position_fallback=%s",
        manager.battle.lead_guid,
        manager.battle.chase_guid,
        manager.battle.initial_gap_spline,
        gap_m,
        lead_car.spline,
        chase_car.spline,
        lead_car.spline_reliable,
        chase_car.spline_reliable,
        getattr(manager, "_position_fallback", False),
    )
    if getattr(manager, "_position_fallback", False):
        notify_position_fallback_mode(manager)
    if not settings.BATTLE_HUD_ENABLED and manager.on_chat_message:
        manager.on_chat_message(manager.battle.lead_guid, "You are LEAD")
        manager.on_chat_message(manager.battle.chase_guid, "You are CHASE")
    manager._publish_hud(
        hud_state="active",
        force=True,
        position_fallback=getattr(manager, "_position_fallback", False),
    )


def _handle_active(manager, car1, car2, distance: float, now: float) -> None:
    lead_car = manager.cars[manager.battle.lead_guid]
    chase_car = manager.cars[manager.battle.chase_guid]

    stall_winner = finish.check_abandon_by_stall(manager, lead_car, chase_car, now)
    if stall_winner and manager._finalize_abandon(stall_winner, "opponent_stalled"):
        return

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
