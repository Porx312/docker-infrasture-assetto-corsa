def format_point_broadcast(manager, winner_guid, reason):
    board = manager._scoreboard_line()
    if reason == "draw":
        return f"DRAW | {board}"
    if reason == "overtake":
        return f"OVERTAKE +1 | {board}"
    if reason == "position_recovery":
        return f"RECOVER +1 | {board}"
    if reason == "outrun":
        return f"OUTRUN +1 | {board}"
    if reason == "dnf_lead_stalled":
        return f"DNF lead +1 | {board}"
    if reason == "dnf_chase_stalled":
        return f"DNF chase +1 | {board}"
    if reason == "finish_outrun":
        return f"FINISH +1 | {board}"
    return f"+1 ({reason}) | {board}"


def notify_touge_chat(manager, message: str) -> None:
    """Send a battle line to both drivers (one chat message each)."""
    if not manager.on_chat_message or not manager.battle:
        return
    manager.on_chat_message(manager.battle.car1_guid, message)
    manager.on_chat_message(manager.battle.car2_guid, message)


def _arming_conditions_hint() -> str:
    from engines.battlesystem.config import BATTLE_ARM_MAX_GAP_METERS, BATTLE_ARM_MIN_SPEED_KMH

    gap_m = int(BATTLE_ARM_MAX_GAP_METERS)
    speed = int(BATTLE_ARM_MIN_SPEED_KMH)
    return f"brake: cancel | continue: {gap_m}m / {speed}km/h"


def format_arming_countdown(seconds_remaining: int) -> str:
    """Countdown while IDLE waits for sustained proximity before ARMED."""
    return f"BATTLE ARM {seconds_remaining} ({_arming_conditions_hint()})"


def notify_arming_countdown(manager, seconds_remaining: int) -> None:
    notify_touge_chat(manager, format_arming_countdown(seconds_remaining))


def notify_arming_cancelled(manager) -> None:
    notify_touge_chat(manager, "BATTLE CANCELLED")


def notify_position_fallback_mode(manager) -> None:
    notify_touge_chat(manager, "BATTLE — position mode (track spline unavailable)")


def notify_battle_cancelled(manager, reason=None):
    if reason == "opponent_stalled":
        msg = "CANCELLED (opponent stopped)"
    elif reason:
        msg = f"CANCELLED ({reason})"
    else:
        msg = "CANCELLED"
    notify_touge_chat(manager, msg)
