import time
from collections import deque
from typing import Optional, Tuple

from engines.battlesystem.config import (
    FINISH_LINE_HIGH_SPLINE,
    FINISH_LINE_LOW_SPLINE,
    GAP_ABORT_MIN_BOTH_SPEED_KMH,
    MIN_LAP_PROGRESS_BEFORE_FINISH,
    SPLINE_MIN_MOVE_METERS,
    SPLINE_STUCK_EPS,
    SPLINE_STUCK_MIN_SPEED_KMH,
    SPLINE_STUCK_SEC,
)
from engines.battlesystem.rules.proximity import distance_3d


class CarState:
    """Tracks the real-time and accumulated state of a single driver."""

    def __init__(self, guid):
        self.guid = guid
        self.spline = 0.0
        self.speed = 0.0
        self.pos = (0.0, 0.0, 0.0)
        self.vel = (0.0, 0.0, 0.0)
        self.driven_spline = 0.0
        self.driven_distance_m = 0.0
        self.spline_reliable = True
        self.last_update_time = 0.0
        self._prev_pos = (0.0, 0.0, 0.0)
        self._spline_stuck_since = 0.0
        self._spline_zero_since = 0.0
        self._spline_invalid_ticks = 0
        self._speed_samples: deque = deque(maxlen=30)
        self.run_active = False
        self.run_lap_completed = False
        self.run_start_spline = 0.0
        self.stall_since = 0.0

    def begin_run(self, start_spline: float) -> None:
        """Reset run progress when a touge ACTIVE phase starts (any track position)."""
        self.run_active = True
        self.run_lap_completed = False
        self.run_start_spline = start_spline
        self.driven_spline = 0.0
        self.driven_distance_m = 0.0
        self.stall_since = 0.0

    def end_run(self) -> None:
        self.run_active = False
        self.run_lap_completed = False

    def mark_lap_completed(self) -> None:
        """Set when ACSP LAP_COMPLETED fires or finish line is crossed on spline."""
        self.run_lap_completed = True

    @staticmethod
    def crossed_finish_line(prev_spline: float, curr_spline: float) -> bool:
        return prev_spline >= FINISH_LINE_HIGH_SPLINE and curr_spline <= FINISH_LINE_LOW_SPLINE

    def _update_stall_timer(self, now: float) -> None:
        """Track sustained low speed (pits / stopped on track) for abandon-by-stall."""
        if self.speed < GAP_ABORT_MIN_BOTH_SPEED_KMH:
            if self.stall_since == 0.0:
                self.stall_since = now
        else:
            self.stall_since = 0.0

    def stall_duration_sec(self, now: float) -> float:
        if self.stall_since <= 0.0:
            return 0.0
        return now - self.stall_since

    def _update_spline_reliability(self, prev_spline: float, spline: float, now: float) -> None:
        if spline < -0.01 or spline > 1.01:
            self.spline_reliable = False
            return

        move_m = distance_3d(self.pos, self._prev_pos) if self.last_update_time > 0 else 0.0

        # NormalizedPosition stuck at 0 (common without fast_lane.ai) — do not wait for 5 m drift.
        if (
            spline <= 0.0
            and self.speed >= SPLINE_STUCK_MIN_SPEED_KMH
            and move_m >= 1.0
        ):
            self._spline_invalid_ticks += 1
            if self._spline_zero_since == 0.0:
                self._spline_zero_since = now
            if self._spline_invalid_ticks >= 2 or (now - self._spline_zero_since) >= SPLINE_STUCK_SEC:
                self.spline_reliable = False
            return

        if self.speed >= SPLINE_STUCK_MIN_SPEED_KMH and move_m >= SPLINE_MIN_MOVE_METERS:
            delta = abs(spline - prev_spline)
            if delta > 0.5:
                delta = 1.0 - delta
            if delta < SPLINE_STUCK_EPS:
                if self._spline_stuck_since == 0.0:
                    self._spline_stuck_since = now
                elif now - self._spline_stuck_since >= SPLINE_STUCK_SEC:
                    self.spline_reliable = False
            else:
                self._spline_stuck_since = 0.0
            self._spline_zero_since = 0.0
            self._spline_invalid_ticks = 0

    def update(
        self,
        spline: float,
        speed: float,
        pos: Tuple[float, float, float],
        vel: Optional[Tuple[float, float, float]] = None,
    ) -> None:
        now = time.time()
        prev_spline = self.spline
        if vel is not None:
            self.vel = vel

        if self.last_update_time > 0:
            move_m = distance_3d(self._prev_pos, pos)
            delta = spline - self.spline
            if delta < -0.5:
                delta += 1.0
            elif delta > 0.5:
                delta -= 1.0
            if delta > 0 and self.spline_reliable:
                self.driven_spline += delta
                if self.driven_spline > 1.0:
                    self.driven_spline = 1.0
            if self.run_active and not self.spline_reliable:
                self.driven_distance_m += move_m

        self._prev_pos = self.pos
        self.spline = spline
        self.speed = speed
        self.pos = pos
        self.last_update_time = now
        self._speed_samples.append((now, speed))
        self._update_stall_timer(now)
        self._update_spline_reliability(prev_spline, spline, now)

        if (
            self.run_active
            and self.spline_reliable
            and not self.run_lap_completed
            and self.driven_spline >= MIN_LAP_PROGRESS_BEFORE_FINISH
            and self.crossed_finish_line(prev_spline, spline)
        ):
            self.run_lap_completed = True

    def speed_drop_in_window(self, min_drop_kmh: float, window_sec: float = 0.5) -> bool:
        """True if speed fell by at least min_drop_kmh within window_sec."""
        if len(self._speed_samples) < 2:
            return False
        now = time.time()
        recent = [s for t, s in self._speed_samples if now - t <= window_sec]
        if len(recent) < 2:
            return False
        return max(recent) - self.speed >= min_drop_kmh


class TougeBattle:
    """Holds the data for a 1v1 touge battle (single run)."""

    def __init__(self, car1_guid, car2_guid):
        self.car1_guid = car1_guid
        self.car2_guid = car2_guid
        self.car1_score = 0
        self.car2_score = 0
        self.lead_guid = None
        self.chase_guid = None
        self.initial_gap_spline = 0.0
        self.winner = None
        self.points_log = []

    def get_opponent(self, guid):
        return self.car2_guid if guid == self.car1_guid else self.car1_guid
