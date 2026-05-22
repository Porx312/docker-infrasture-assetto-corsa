import time

from core.logging_config import get_logger
from engines.battlesystem.config import (
    ABANDON_MIN_PROGRESS_FOR_WIN,
    ABANDON_MIN_PROGRESS_METERS,
    FINISH_POINT_MIN_GAP_METERS,
)
from engines.battlesystem.rules.proximity import pair_uses_position_fallback_from_manager
from engines.battlesystem.chat import format_point_broadcast, notify_touge_chat

log = get_logger("battlesystem.scoring")


def score_of(manager, guid):
    if not manager.battle:
        return 0
    if guid == manager.battle.car1_guid:
        return manager.battle.car1_score
    if guid == manager.battle.car2_guid:
        return manager.battle.car2_score
    return 0


def battle_has_points(manager) -> bool:
    if not manager.battle:
        return False
    return (manager.battle.car1_score + manager.battle.car2_score) > 0


def battle_run_progress(manager) -> float:
    """Max lap fraction driven since GO across both drivers (0–1)."""
    if not manager.battle:
        return 0.0
    progress = 0.0
    for guid in (manager.battle.car1_guid, manager.battle.car2_guid):
        car = manager.cars.get(guid)
        if car:
            progress = max(progress, car.driven_spline)
    return progress


def battle_run_distance_m(manager) -> float:
    """Max 3D distance driven since GO when spline is unavailable."""
    if not manager.battle:
        return 0.0
    distance = 0.0
    for guid in (manager.battle.car1_guid, manager.battle.car2_guid):
        car = manager.cars.get(guid)
        if car:
            distance = max(distance, car.driven_distance_m)
    return distance


def abandon_should_award_win(manager) -> bool:
    """True when abandon should produce a winner (points on board or enough run progress)."""
    if battle_has_points(manager):
        return True
    if pair_uses_position_fallback_from_manager(manager):
        return battle_run_distance_m(manager) >= ABANDON_MIN_PROGRESS_METERS
    return battle_run_progress(manager) >= ABANDON_MIN_PROGRESS_FOR_WIN


def finalize_abandon(manager, winner_guid, reason) -> bool:
    """
    End an ACTIVE battle when opponents separate (250 m) or disconnect.
    Winner if points were scored, or at 0-0 when the pair ran >= ABANDON_MIN_PROGRESS_FOR_WIN;
    otherwise cancel (instant separation at start).
    """
    if manager.state != "ACTIVE" or not manager.battle:
        return False

    if winner_guid and abandon_should_award_win(manager):
        return finalize_default_win(manager, winner_guid, reason)

    log.info(
        "battle cancelled (%s) score=%s-%s winner_candidate=%s",
        reason,
        manager.battle.car1_score,
        manager.battle.car2_score,
        winner_guid,
    )
    manager._notify_battle_cancelled(reason)
    manager.state = "FINISHED"
    manager.finished_time = time.time()
    return True


def finalize_default_win(manager, winner_guid, reason):
    if manager.state != "ACTIVE" or not manager.battle or not winner_guid:
        return False

    manager.battle.winner = winner_guid
    wn = manager._display_name(winner_guid)
    log.info(
        "abandon win %s reason=%s score=%s-%s",
        winner_guid,
        reason,
        manager.battle.car1_score,
        manager.battle.car2_score,
    )
    msg = f"WIN {wn} — opponent abandoned ({reason}) | {manager._scoreboard_line()}"
    notify_touge_chat(manager, msg)
    if manager.on_score_update:
        manager.on_score_update(
            manager.battle_id,
            manager.battle.car1_score,
            manager.battle.car2_score,
            manager.battle.winner,
            manager.battle.points_log,
            manager.battle.car1_guid,
            manager.battle.car2_guid,
        )
    manager.state = "FINISHED"
    manager.finished_time = time.time()
    return True


def finalize_single_session_result(manager, finish_gap_m, is_draw):
    if manager.state != "ACTIVE":
        return
    if manager.battle.car1_score > manager.battle.car2_score:
        winner = manager.battle.car1_guid
    elif manager.battle.car2_score > manager.battle.car1_score:
        winner = manager.battle.car2_guid
    else:
        winner = None

    manager.battle.winner = winner
    board = manager._scoreboard_line()
    if winner:
        wn = manager._display_name(winner)
        log.info(
            "session over winner=%s (finish gap=%.1fm)",
            winner,
            finish_gap_m,
        )
        msg = f"FINISH — WIN {wn} (+1, gap {finish_gap_m:.0f}m) | {board}"
    else:
        log.info("session over DRAW finish_gap=%.1fm", finish_gap_m)
        msg = f"FINISH — DRAW (gap {finish_gap_m:.0f}m) | {board}"
    notify_touge_chat(manager, msg)
    if manager.on_score_update:
        manager.on_score_update(
            manager.battle_id,
            manager.battle.car1_score,
            manager.battle.car2_score,
            manager.battle.winner,
            manager.battle.points_log,
            manager.battle.car1_guid,
            manager.battle.car2_guid,
        )
    manager.state = "FINISHED"
    manager.finished_time = time.time()


def award_point(manager, winner_guid, reason="outrun", *, skip_chat: bool = False):
    if winner_guid == manager.battle.car1_guid:
        manager.battle.car1_score += 1
        log_msg = f"Point to {manager.battle.car1_guid} ({reason})"
    elif winner_guid == manager.battle.car2_guid:
        manager.battle.car2_score += 1
        log_msg = f"Point to {manager.battle.car2_guid} ({reason})"
    else:
        log_msg = f"DRAW ({reason})"

    manager.battle.points_log.append(
        {"scorer": winner_guid, "reason": reason, "ts": int(time.time() * 1000)}
    )
    log.info(
        "%s score=%s-%s",
        log_msg,
        manager.battle.car1_score,
        manager.battle.car2_score,
    )

    if not skip_chat and manager.on_chat_message:
        msg = format_point_broadcast(manager, winner_guid, reason)
        manager.on_chat_message(manager.battle.car1_guid, msg)
        manager.on_chat_message(manager.battle.car2_guid, msg)
