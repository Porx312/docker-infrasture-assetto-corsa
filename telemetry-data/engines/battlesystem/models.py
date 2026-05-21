import time
from collections import deque

from engines.battlesystem.config import (
    FINISH_LINE_HIGH_SPLINE,
    FINISH_LINE_LOW_SPLINE,
    MIN_LAP_PROGRESS_BEFORE_FINISH,
)


class CarState:
    """Tracks the real-time and accumulated state of a single driver."""

    def __init__(self, guid):
        self.guid = guid
        self.spline = 0.0
        self.speed = 0.0
        self.pos = (0.0, 0.0, 0.0)
        self.driven_spline = 0.0
        self.last_update_time = 0.0
        self._speed_samples: deque = deque(maxlen=30)
        self.run_active = False
        self.run_lap_completed = False
        self.run_start_spline = 0.0

    def begin_run(self, start_spline: float) -> None:
        """Reset run progress when a touge ACTIVE phase starts (any track position)."""
        self.run_active = True
        self.run_lap_completed = False
        self.run_start_spline = start_spline
        self.driven_spline = 0.0

    def end_run(self) -> None:
        self.run_active = False
        self.run_lap_completed = False

    def mark_lap_completed(self) -> None:
        """Set when ACSP LAP_COMPLETED fires or finish line is crossed on spline."""
        self.run_lap_completed = True

    @staticmethod
    def crossed_finish_line(prev_spline: float, curr_spline: float) -> bool:
        return prev_spline >= FINISH_LINE_HIGH_SPLINE and curr_spline <= FINISH_LINE_LOW_SPLINE

    def update(self, spline, speed, pos):
        now = time.time()
        prev_spline = self.spline
        if self.last_update_time > 0:
            delta = spline - self.spline
            if delta < -0.5:
                delta += 1.0
            elif delta > 0.5:
                delta -= 1.0
            if delta > 0:
                self.driven_spline += delta
                if self.driven_spline > 1.0:
                    self.driven_spline = 1.0
        self.spline = spline
        self.speed = speed
        self.pos = pos
        self.last_update_time = now
        self._speed_samples.append((now, speed))

        if (
            self.run_active
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
