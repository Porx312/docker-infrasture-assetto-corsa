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


def notify_battle_cancelled(manager, reason=None):
    msg = f"CANCELLED ({reason})" if reason else "CANCELLED"
    notify_touge_chat(manager, msg)
