import time
from collections import deque


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

    def update(self, spline, speed, pos):
        now = time.time()
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
