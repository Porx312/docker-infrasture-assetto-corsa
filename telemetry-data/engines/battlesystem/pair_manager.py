from core.logging_config import get_logger
from engines.battlesystem.chat import format_point_broadcast, notify_battle_cancelled
from engines.battlesystem.config import (
    FINISHED_COOLDOWN_SEC,
    OVERTAKE_ACTIVE_GRACE_SEC,
    OVERTAKE_MARGIN_SPLINE,
    OVERTAKE_PASS_MARGIN_SPLINE,
)
from engines.battlesystem.models import CarState
from engines.battlesystem.rules.proximity import distance_3d
from engines.battlesystem.scoring import (
    award_point,
    finalize_abandon,
    finalize_default_win,
    finalize_single_session_result,
    score_of,
)
from engines.battlesystem.state_machine import process_pair_logic

log = get_logger("battlesystem.pair")


class PairBattleManager:
    """
    Manages the full Touge battle state machine:
    IDLE -> ARMED -> LAUNCHING -> ACTIVE -> FINISHED
    """

    def __init__(self):
        self.state = "IDLE"
        self.cars = {}
        self.battle = None
        self.is_battle_server = False

        self.condition_start_time = 0.0
        self.launch_trigger_time = 0.0

        self.on_battle_start = None
        self.on_score_update = None
        self.on_chat_message = None
        self.on_battle_end = None

        self.battle_id = None
        self.finished_time = 0.0
        self.FINISHED_COOLDOWN = FINISHED_COOLDOWN_SEC
        self.overtake_margin_spline = OVERTAKE_MARGIN_SPLINE
        self.overtake_pass_margin_spline = OVERTAKE_PASS_MARGIN_SPLINE
        self._overtake_active_grace_sec = OVERTAKE_ACTIVE_GRACE_SEC
        self.active_start_time = 0.0
        self.player_names = {}
        self._overtake_chase_scored = False
        self._last_overtake_point_ts = 0.0
        self._chase_was_ahead_on_track = False
        self._lead_was_ahead_on_track = False

    def set_server_mode(self, is_battle_server):
        is_battle = bool(is_battle_server)
        if self.is_battle_server == is_battle:
            return
        self.is_battle_server = is_battle
        if not self.is_battle_server:
            self._reset_to_idle(full_reset=True)
            self.battle = None

    def set_driver_name(self, guid, name):
        if not guid or not name or str(guid).startswith("unknown"):
            return
        self.player_names[guid] = str(name).strip()

    def _display_name(self, guid):
        if not guid:
            return "?"
        n = self.player_names.get(guid)
        if n:
            return n
        return f"...{guid[-6:]}" if len(guid) > 6 else guid

    def _scoreboard_line(self):
        g1, g2 = self.battle.car1_guid, self.battle.car2_guid
        return f"{self._display_name(g1)} {self.battle.car1_score} : {self._display_name(g2)} {self.battle.car2_score}"

    def _score_of(self, guid):
        return score_of(self, guid)

    def _finalize_default_win(self, winner_guid, reason):
        return finalize_default_win(self, winner_guid, reason)

    def _finalize_abandon(self, winner_guid, reason):
        return finalize_abandon(self, winner_guid, reason)

    def _format_point_broadcast(self, winner_guid, reason):
        return format_point_broadcast(self, winner_guid, reason)

    def _notify_battle_cancelled(self, reason=None):
        notify_battle_cancelled(self, reason)

    def get_distance(self, pos1, pos2):
        return distance_3d(pos1, pos2)

    def update(self, driver_guid, spline, speed, world_position):
        if not self.is_battle_server:
            return
        if driver_guid not in self.cars:
            self.cars[driver_guid] = CarState(driver_guid)
        self.cars[driver_guid].update(spline, speed, world_position)
        try:
            self._process_logic()
        except Exception as e:
            log.exception("logic error (non-fatal): %s", e)

    def remove_car(self, driver_guid):
        if driver_guid in self.cars:
            del self.cars[driver_guid]
        if self.state in ("ARMED", "LAUNCHING", "ACTIVE"):
            log.info("player %s disconnected, cancelling battle", driver_guid)
            remaining = None
            if self.battle:
                remaining = (
                    self.battle.car2_guid
                    if driver_guid == self.battle.car1_guid
                    else self.battle.car1_guid
                )
            self._finalize_abandon(remaining, "opponent_disconnected")

    def _reset_to_idle(self, full_reset=False):
        self.state = "IDLE"
        self.condition_start_time = 0.0
        self.launch_trigger_time = 0.0
        if full_reset:
            self.finished_time = 0.0
            self.battle_id = None

    def handle_collision(self, car1_guid, car2_guid, impact_speed):
        """Battle mode does not award points or chat for car-to-car collisions."""

    def _process_logic(self):
        process_pair_logic(self)

    def _finalize_single_session_result(self, finish_gap_m, is_draw):
        finalize_single_session_result(self, finish_gap_m, is_draw)

    def _award_point(self, winner_guid, reason="outrun", **kwargs):
        award_point(self, winner_guid, reason, **kwargs)

    def _abort_run_no_point(self, reason):
        log.info("run aborted (%s), no point", reason)
        self.state = "IDLE"
