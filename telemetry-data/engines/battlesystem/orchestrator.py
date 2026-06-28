import time

from core.logging_config import get_logger
from engines.battlesystem.models import CarState, TougeBattle
from engines.battlesystem.pair_manager import PairBattleManager
from engines.battlesystem.config import (
    BATTLE_ARM_MAX_GAP_METERS,
    BATTLE_ARM_MIN_SPEED_KMH,
    FINISHED_COOLDOWN_SEC,
    LAUNCH_TIMEOUT_SEC,
    SPLINE_STUCK_MIN_SPEED_KMH,
)
from engines.battlesystem.rules.proximity import distance_3d, is_within_battle_gap

log = get_logger("battlesystem.orchestrator")


class BattleManager:
    """
    Orchestrates multiple concurrent 1v1 touge battles on open servers.
    Each active pair runs an isolated PairBattleManager state machine.
    """

    def __init__(self):
        self.is_battle_server = False
        self.cars = {}  # guid -> CarState (global telemetry cache)
        self.player_names = {}
        self.pair_managers = {}  # (guid_a, guid_b) sorted -> PairBattleManager
        self.guid_to_pair = {}  # guid -> pair key
        self.recent_pair_cooldowns = {}  # (guid_a, guid_b) sorted -> expires_at

        # External callbacks (same contract as legacy manager).
        self.on_battle_start = None
        self.on_score_update = None
        self.on_chat_message = None
        self.on_hud_update = None

    @staticmethod
    def _pair_key(g1, g2):
        return tuple(sorted((g1, g2)))

    def _make_on_battle_end(self, key):
        def on_battle_end(*, rematch_cooldown: bool = False):
            self._release_pair(key, apply_rematch_cooldown=rematch_cooldown)

        return on_battle_end

    def _release_pair(self, key, *, apply_rematch_cooldown: bool = False):
        self.pair_managers.pop(key, None)
        for g in key:
            if self.guid_to_pair.get(g) == key:
                self.guid_to_pair.pop(g, None)
        if apply_rematch_cooldown:
            self.recent_pair_cooldowns[key] = time.time() + FINISHED_COOLDOWN_SEC

    def _build_pair_manager(self, g1, g2):
        mgr = PairBattleManager()
        mgr.set_server_mode(True)
        mgr.battle = TougeBattle(g1, g2)
        mgr._reset_to_idle(full_reset=True)
        mgr.player_names[g1] = self.player_names.get(g1, g1)
        mgr.player_names[g2] = self.player_names.get(g2, g2)
        key = self._pair_key(g1, g2)
        mgr.on_battle_end = self._make_on_battle_end(key)
        mgr.pair_locked_at = time.time()
        # Callbacks are proxied to server_state handlers.
        mgr.on_battle_start = self.on_battle_start
        mgr.on_score_update = self.on_score_update
        mgr.on_chat_message = self.on_chat_message
        mgr.on_hud_update = self.on_hud_update
        return mgr

    def _cleanup_pair_if_done(self, key):
        mgr = self.pair_managers.get(key)
        if not mgr:
            return
        b = mgr.battle
        if not b:
            return
        p1 = mgr.cars.get(b.car1_guid)
        p2 = mgr.cars.get(b.car2_guid)
        # If either participant vanished from this sub-manager, drop pair mapping.
        if not p1 or not p2:
            self.pair_managers.pop(key, None)
            for g in key:
                if self.guid_to_pair.get(g) == key:
                    self.guid_to_pair.pop(g, None)

    def _try_matchmake(self):
        now = time.time()
        self.recent_pair_cooldowns = {
            k: expires_at for k, expires_at in self.recent_pair_cooldowns.items() if expires_at > now
        }
        # Candidates not currently locked to any pair and recently active.
        free = []
        for g, c in self.cars.items():
            if (now - c.last_update_time) > 3.0:
                continue
            if g in self.guid_to_pair:
                continue
            free.append(g)
        if len(free) < 2:
            return

        # Greedy nearest-neighbor matching under lock constraints.
        while len(free) >= 2:
            best = None
            best_dist = None
            for i in range(len(free)):
                for j in range(i + 1, len(free)):
                    g1 = free[i]
                    g2 = free[j]
                    c1 = self.cars.get(g1)
                    c2 = self.cars.get(g2)
                    if not c1 or not c2:
                        continue
                    if c1.speed <= BATTLE_ARM_MIN_SPEED_KMH or c2.speed <= BATTLE_ARM_MIN_SPEED_KMH:
                        continue
                    if not is_within_battle_gap(c1.pos, c2.pos, BATTLE_ARM_MAX_GAP_METERS):
                        continue
                    key = self._pair_key(g1, g2)
                    if self.recent_pair_cooldowns.get(key, 0.0) > now:
                        continue
                    dist = distance_3d(c1.pos, c2.pos)
                    if best_dist is None or dist < best_dist:
                        best_dist = dist
                        best = (g1, g2)
            if not best:
                return

            g1, g2 = best
            key = self._pair_key(g1, g2)
            if key not in self.pair_managers:
                mgr = self._build_pair_manager(g1, g2)
                self.pair_managers[key] = mgr
                self.guid_to_pair[g1] = key
                self.guid_to_pair[g2] = key
                log.info(
                    "pair locked %s vs %s (active pairs: %d)",
                    mgr._display_name(g1),
                    mgr._display_name(g2),
                    len(self.pair_managers),
                )
                mgr._publish_hud(hud_state="pairing", force=True)
            free = [g for g in free if g not in (g1, g2)]

    def set_server_mode(self, is_battle_server):
        is_battle = bool(is_battle_server)
        if self.is_battle_server == is_battle:
            return
        self.is_battle_server = is_battle
        if not self.is_battle_server:
            self.pair_managers.clear()
            self.guid_to_pair.clear()
            self.recent_pair_cooldowns.clear()
            return
        log.info(
            "battle config arm_gap=%.0fm arm_speed=%.0f km/h launch_timeout=%.0fs "
            "spline_stuck_min_speed=%.0f km/h",
            BATTLE_ARM_MAX_GAP_METERS,
            BATTLE_ARM_MIN_SPEED_KMH,
            LAUNCH_TIMEOUT_SEC,
            SPLINE_STUCK_MIN_SPEED_KMH,
        )

    def set_driver_name(self, guid, name):
        if not guid or not name or str(guid).startswith("unknown"):
            return
        self.player_names[guid] = str(name).strip()
        key = self.guid_to_pair.get(guid)
        if key and key in self.pair_managers:
            self.pair_managers[key].set_driver_name(guid, name)

    def update(self, driver_guid, spline, speed, world_position, vel=None):
        if not self.is_battle_server:
            return
        if driver_guid not in self.cars:
            self.cars[driver_guid] = CarState(driver_guid)
        self.cars[driver_guid].update(spline, speed, world_position, vel=vel)

        self._try_matchmake()
        key = self.guid_to_pair.get(driver_guid)
        if not key:
            return
        mgr = self.pair_managers.get(key)
        if not mgr:
            self.guid_to_pair.pop(driver_guid, None)
            return

        # Mirror both participants latest telemetry into pair manager.
        b = mgr.battle
        if not b:
            return
        for guid in (b.car1_guid, b.car2_guid):
            c = self.cars.get(guid)
            if not c:
                continue
            if guid not in mgr.cars:
                mgr.cars[guid] = CarState(guid)
            mgr.cars[guid].update(c.spline, c.speed, c.pos, vel=c.vel)
            n = self.player_names.get(guid)
            if n:
                mgr.player_names[guid] = n

        try:
            mgr._process_logic()
        except Exception as e:
            log.exception("pair logic error (non-fatal): %s", e)

        self._cleanup_pair_if_done(key)

    def handle_lap_completed(self, driver_guid: str) -> None:
        if not self.is_battle_server:
            return
        key = self.guid_to_pair.get(driver_guid)
        if not key:
            return
        mgr = self.pair_managers.get(key)
        if mgr:
            mgr.handle_lap_completed(driver_guid)

    def handle_collision(self, car1_guid, car2_guid, impact_speed):
        if not self.is_battle_server:
            return
        key1 = self.guid_to_pair.get(car1_guid)
        key2 = self.guid_to_pair.get(car2_guid)
        if not key1 or key1 != key2:
            return
        mgr = self.pair_managers.get(key1)
        if not mgr:
            return
        mgr.handle_collision(car1_guid, car2_guid, impact_speed)

    def remove_car(self, driver_guid):
        self.cars.pop(driver_guid, None)
        self.player_names.pop(driver_guid, None)
        key = self.guid_to_pair.get(driver_guid)
        if not key:
            return
        mgr = self.pair_managers.get(key)
        if mgr:
            mgr.remove_car(driver_guid)
        self._release_pair(key)
